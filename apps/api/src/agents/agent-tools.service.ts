import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import {
  AgentToolName,
  InstrumentType,
  QuoteSnapshot,
  StrategyConfig,
  ToolCalculateIndicatorsInput,
  ToolCalculateIndicatorsOutput,
  ToolScanUniverseInput,
  ToolScanUniverseOutput,
  ScannedInstrumentCandidate,
} from '@trading-bot/contracts';
import {
  Candle,
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  validateWarmup,
  evaluateStrategyRules,
  StrategyEvaluationResult,
} from '@trading-bot/domain';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';

export class AgentSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentSecurityViolationError';
  }
}

@Injectable()
export class AgentToolsService {
  // Candle buffer per instrument for historical closed bars (5m timeframe)
  private closedCandleStore: Map<string, Candle[]> = new Map();
  private verifiedClosedCandleStore: Map<string, Candle[]> = new Map();
  private formingCandles = new Map<string, { bucket: number; candle: Candle; volumeAtOpen: number; complete: boolean }>();

  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
  ) {
    this.seedHistoricalCandles();
    this.feed.observeQuotes?.((quote) => this.collectClosedCandle(quote));
  }

  /**
   * Universal Dispatcher for Agent Tools
   * STRICT SAFETY INVARIANT: Only read-only tools in AgentToolName can ever be executed.
   * Any attempt to invoke order placement or modification triggers a hard security violation.
   */
  public async executeTool(toolName: string, input: any): Promise<any> {
    const allowedTools = Object.values(AgentToolName) as string[];
    if (!allowedTools.includes(toolName)) {
      throw new AgentSecurityViolationError(
        `SECURITY VIOLATION: Tool '${toolName}' is prohibited. Agents are restricted strictly to read-only analytical tools. No broker order/write access permitted.`,
      );
    }

    switch (toolName) {
      case AgentToolName.SCAN_UNIVERSE:
        return this.scanUniverse(input);
      case AgentToolName.CALCULATE_INDICATORS:
        return this.calculateIndicators(input);
      case AgentToolName.EVALUATE_STRATEGY:
        return this.evaluateStrategy(input.strategy, input.instrumentKey, input.requireFreshQuotes);
      default:
        throw new BadRequestException(`Unhandled read-only tool: ${toolName}`);
    }
  }

  /**
   * Tool: scan_universe
   * Scans available F&O instruments, evaluates live liquidity, calculates spread %, and ranks candidates.
   */
  public async scanUniverse(input: ToolScanUniverseInput & { requireFreshQuotes?: boolean }): Promise<ToolScanUniverseOutput> {
    const underlying = input.underlying || 'NIFTY';
    const minVolume = input.minVolume ?? 1000;
    const maxSpreadPct = input.maxSpreadPct ?? 1.0;

    // Get spot price
    const spotKey = underlying === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
    const spotQuote = this.feed.getQuote(spotKey);
    const spotPrice = spotQuote?.lastPrice ?? (underlying === 'NIFTY' ? 25120.0 : 52350.0);

    const instruments = this.catalog.getUnderlyingInstruments(underlying);
    const candidates: ScannedInstrumentCandidate[] = [];

    for (const inst of instruments) {
      if (inst.instrumentType !== InstrumentType.CE && inst.instrumentType !== InstrumentType.PE) {
        continue;
      }

      // Filter by expiry if provided
      if (input.expiry && inst.symbol && !inst.symbol.includes(input.expiry)) {
        continue;
      }

      // Fetch or compute quote
      const quote = this.feed.getQuote(inst.instrumentKey) || (input.requireFreshQuotes ? undefined : this.generateFallbackQuote(inst, spotPrice));
      if (!quote || (input.requireFreshQuotes && !this.isFreshQuote(quote))) continue;

      const bid = quote.bidPrice > 0 ? quote.bidPrice : quote.lastPrice;
      const ask = quote.askPrice > 0 ? quote.askPrice : quote.lastPrice;
      const spreadPct = ask > 0 ? Number((((ask - bid) / ask) * 100).toFixed(2)) : 999;

      if (spreadPct <= maxSpreadPct && quote.volume >= minVolume) {
        // Compute liquidity score 0-100 (tighter spread + higher volume = higher score)
        const spreadScore = Math.max(0, 50 - spreadPct * 30);
        const volumeScore = Math.min(50, (quote.volume / 10000) * 10);
        const liquidityScore = Math.min(100, Number((spreadScore + volumeScore).toFixed(1)));

        candidates.push({
          instrumentKey: inst.instrumentKey,
          symbol: inst.symbol,
          strikePrice: inst.strikePrice ?? spotPrice,
          instrumentType: inst.instrumentType,
          lastPrice: quote.lastPrice,
          bidPrice: bid,
          askPrice: ask,
          spreadPct,
          volume: quote.volume,
          openInterest: quote.openInterest,
          lotSize: inst.lotSize,
          liquidityScore,
        });
      }
    }

    // Sort descending by liquidity score
    candidates.sort((a, b) => b.liquidityScore - a.liquidityScore);

    return {
      underlying,
      spotPrice,
      candidates,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Tool: calculate_indicators
   * Pulls confirmed closed bars, checks indicator warm-up, and calculates EMA, RSI, and VWAP.
   */
  public async calculateIndicators(
    input: ToolCalculateIndicatorsInput & { requireFreshQuotes?: boolean },
  ): Promise<ToolCalculateIndicatorsOutput> {
    const candles = this.getClosedCandles(input.instrumentKey, input.requireFreshQuotes);
    const emaPeriod = input.emaPeriod ?? 20;
    const rsiPeriod = input.rsiPeriod ?? 14;

    const warmup = validateWarmup(candles, emaPeriod, rsiPeriod);
    if (!warmup.isWarmedUp) {
      return {
        instrumentKey: input.instrumentKey,
        timeframe: input.timeframe,
        totalClosedCandles: candles.length,
        isWarmedUp: false,
        missingWarmupCandles: warmup.missingCandles,
      };
    }

    const closes = candles.map((c) => c.close);
    const emaValues = calculateEMA(closes, emaPeriod);
    const rsiValues = calculateRSI(closes, rsiPeriod);
    const vwapValues = calculateVWAP(candles);

    const currEma = emaValues[emaValues.length - 1];
    const prevEma = emaValues.length > 1 ? emaValues[emaValues.length - 2] : currEma;
    const currRsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues.length > 1 ? rsiValues[rsiValues.length - 2] : currRsi;
    const currVwap = vwapValues[vwapValues.length - 1];
    const lastCandle = candles[candles.length - 1];

    return {
      instrumentKey: input.instrumentKey,
      timeframe: input.timeframe,
      totalClosedCandles: candles.length,
      isWarmedUp: true,
      missingWarmupCandles: 0,
      lastClosedCandleTime: String(lastCandle?.timestamp),
      ema: currEma,
      previousEma: prevEma,
      rsi: currRsi,
      previousRsi: prevRsi,
      vwap: currVwap,
      closePrice: lastCandle?.close,
    };
  }

  /**
   * Tool: evaluate_strategy
   * Evaluates strategy rules on closed bars and candidate quotes.
   */
  public async evaluateStrategy(
    strategy: StrategyConfig,
    candidateInstrumentKey: string,
    requireFreshQuotes = false,
  ): Promise<StrategyEvaluationResult> {
    const underlyingKey =
      strategy.underlying === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
    const spotCandles = this.getClosedCandles(underlyingKey, requireFreshQuotes);
    const candidateQuote =
      this.feed.getQuote(candidateInstrumentKey) ||
      (requireFreshQuotes ? undefined : this.generateFallbackQuote({ instrumentKey: candidateInstrumentKey } as any, 25100));
    if (!candidateQuote || (requireFreshQuotes && !this.isFreshQuote(candidateQuote))) {
      return { passed: false, signal: 'NONE', confidence: 0, reasons: ['Fresh executable option quote is unavailable.'], metrics: { closedCandlesCount: spotCandles.length, isWarmedUp: false } };
    }

    const now = new Date();
    const currentTimeIst = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(now);

    return evaluateStrategyRules({
      strategy,
      underlyingCandles: spotCandles,
      candidateQuote,
      currentTimeIst,
    });
  }

  public getClosedCandles(instrumentKey: string, verifiedOnly = false): Candle[] {
    return (verifiedOnly ? this.verifiedClosedCandleStore : this.closedCandleStore).get(instrumentKey) || [];
  }

  public setClosedCandles(instrumentKey: string, candles: Candle[]): void {
    this.closedCandleStore.set(instrumentKey, candles);
    this.verifiedClosedCandleStore.set(instrumentKey, candles);
  }

  private isFreshQuote(quote: QuoteSnapshot): boolean {
    const age = Date.now() - Date.parse(quote.timestamp);
    return !quote.isStale && Number.isFinite(age) && age >= -1000 && age <= 3000 && quote.bidPrice > 0 && quote.askPrice >= quote.bidPrice;
  }

  /** Build 5m closed bars from observed feed data. Never use seeded analytical examples for execution. */
  private collectClosedCandle(quote: QuoteSnapshot): void {
    if (!quote.instrumentKey.startsWith('NSE_INDEX|') || !this.isFreshQuote(quote) || !Number.isFinite(quote.lastPrice) || quote.lastPrice <= 0) return;
    const timestamp = Date.parse(quote.timestamp);
    const bucket = Math.floor(timestamp / 300000) * 300000;
    const previous = this.formingCandles.get(quote.instrumentKey);
    if (previous && bucket < previous.bucket) return;
    if (!previous || bucket > previous.bucket) {
      if (previous?.complete && bucket === previous.bucket + 300000) {
        const bars = this.verifiedClosedCandleStore.get(quote.instrumentKey) ?? [];
        bars.push({ ...previous.candle, timestamp: new Date(previous.bucket + 300000).toISOString() });
        this.verifiedClosedCandleStore.set(quote.instrumentKey, bars.slice(-200));
      }
      this.formingCandles.set(quote.instrumentKey, { bucket, complete: timestamp - bucket < 3000, volumeAtOpen: quote.volume, candle: { timestamp: new Date(bucket + 300000).toISOString(), open: quote.lastPrice, high: quote.lastPrice, low: quote.lastPrice, close: quote.lastPrice, volume: 0 } });
      return;
    }
    previous.candle.high = Math.max(previous.candle.high, quote.lastPrice);
    previous.candle.low = Math.min(previous.candle.low, quote.lastPrice);
    previous.candle.close = quote.lastPrice;
    previous.candle.volume = Math.max(0, quote.volume - previous.volumeAtOpen);
  }

  private seedHistoricalCandles(): void {
    // Seed 40 historical 5m closed candles for Nifty 50 (bullish trending setup)
    const niftyCandles: Candle[] = [];
    const baseTime = Date.now() - 40 * 5 * 60 * 1000;
    let price = 25000.0;

    for (let i = 0; i < 40; i++) {
      price += Math.sin(i / 5) * 6 + 3.5; // Steady upward drift
      niftyCandles.push({
        timestamp: new Date(baseTime + i * 300000).toISOString(),
        open: Number((price - 4).toFixed(2)),
        high: Number((price + 8).toFixed(2)),
        low: Number((price - 6).toFixed(2)),
        close: Number(price.toFixed(2)),
        volume: 25000 + i * 200,
      });
    }

    this.closedCandleStore.set('NSE_INDEX|Nifty 50', niftyCandles);
    this.closedCandleStore.set('NSE_INDEX|Nifty Bank', niftyCandles);
  }

  private generateFallbackQuote(inst: any, spotPrice: number): QuoteSnapshot {
    const strike = inst.strikePrice ?? spotPrice;
    const isCall = inst.instrumentType === InstrumentType.CE;
    const diff = isCall ? spotPrice - strike : strike - spotPrice;
    const intrinsic = Math.max(0, diff);
    const timeValue = 65.0;
    const estPrice = Math.max(15, Number((intrinsic + timeValue).toFixed(2)));

    return {
      instrumentKey: inst.instrumentKey,
      lastPrice: estPrice,
      bidPrice: Number((estPrice - 0.25).toFixed(2)),
      askPrice: Number((estPrice + 0.25).toFixed(2)),
      bidQty: 250,
      askQty: 300,
      volume: 45000,
      openInterest: 120000,
      timestamp: new Date().toISOString(),
      isStale: false,
      netChange: 0,
      netChangePct: 0,
    };
  }
}
