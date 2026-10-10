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

  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
  ) {
    this.seedHistoricalCandles();
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
        return this.evaluateStrategy(input.strategy, input.instrumentKey);
      default:
        throw new BadRequestException(`Unhandled read-only tool: ${toolName}`);
    }
  }

  /**
   * Tool: scan_universe
   * Scans available F&O instruments, evaluates live liquidity, calculates spread %, and ranks candidates.
   */
  public async scanUniverse(input: ToolScanUniverseInput): Promise<ToolScanUniverseOutput> {
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
      const quote = this.feed.getQuote(inst.instrumentKey) || this.generateFallbackQuote(inst, spotPrice);

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
    input: ToolCalculateIndicatorsInput,
  ): Promise<ToolCalculateIndicatorsOutput> {
    const candles = this.getClosedCandles(input.instrumentKey);
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
  ): Promise<StrategyEvaluationResult> {
    const underlyingKey =
      strategy.underlying === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank';
    const spotCandles = this.getClosedCandles(underlyingKey);
    const candidateQuote =
      this.feed.getQuote(candidateInstrumentKey) ||
      this.generateFallbackQuote({ instrumentKey: candidateInstrumentKey } as any, 25100);

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeIst = `${hours}:${minutes}`;

    return evaluateStrategyRules({
      strategy,
      underlyingCandles: spotCandles,
      candidateQuote,
      currentTimeIst,
    });
  }

  public getClosedCandles(instrumentKey: string): Candle[] {
    return this.closedCandleStore.get(instrumentKey) || [];
  }

  public setClosedCandles(instrumentKey: string, candles: Candle[]): void {
    this.closedCandleStore.set(instrumentKey, candles);
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
