import { Injectable, Inject, BadRequestException, Optional } from '@nestjs/common';
import { TokenStorageService } from '../broker/token-storage.service';
import { AgentToolName, InstrumentType, QuoteSnapshot, StrategyConfig, ToolCalculateIndicatorsInput, ToolCalculateIndicatorsOutput, ToolScanUniverseInput, ToolScanUniverseOutput, ScannedInstrumentCandidate } from '@trading-bot/contracts';
import { Candle, calculateEMA, calculateRSI, calculateVWAP, validateWarmup, evaluateStrategyRules, StrategyEvaluationResult, strategyTimeframeMinutes } from '@trading-bot/domain';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';

export class AgentSecurityViolationError extends Error {
  constructor(message: string) { super(message); this.name = 'AgentSecurityViolationError'; }
}

@Injectable()
export class AgentToolsService {
  private closedCandles = new Map<string, Candle[]>();
  private formingCandles = new Map<string, { bucket: number; candle: Candle; volumeAtOpen: number; complete: boolean }>();
  private readonly timeframes = ['1m', '5m', '15m', '30m', '1d'];
  private historyFetchedAt = new Map<string, number>();
  private historyRequests = new Map<string, Promise<void>>();

  constructor(@Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Optional() @Inject(TokenStorageService) private readonly tokens?: TokenStorageService) {
    this.feed.observeQuotes?.(quote => this.collectClosedCandle(quote));
  }

  async executeTool(toolName: string, input: any): Promise<any> {
    if (!(Object.values(AgentToolName) as string[]).includes(toolName)) throw new AgentSecurityViolationError('Agents have read-only analytical tools; order or account writes are prohibited.');
    switch (toolName) {
      case AgentToolName.SCAN_UNIVERSE: return this.scanUniverse(input);
      case AgentToolName.CALCULATE_INDICATORS: return this.calculateIndicators(input);
      case AgentToolName.EVALUATE_STRATEGY: return this.evaluateStrategy(input.strategy, input.instrumentKey, input.requireFreshQuotes);
      default: throw new BadRequestException('Unsupported analytical tool.');
    }
  }

  async scanUniverse(input: ToolScanUniverseInput & { requireFreshQuotes?: boolean }): Promise<ToolScanUniverseOutput> {
    const underlying = input.underlying || 'NIFTY';
    const key = this.underlyingKey(underlying);
    const spot = this.feed.getQuote(key);
    const candidates: ScannedInstrumentCandidate[] = [];
    if (this.fresh(spot, false)) {
      for (const instrument of this.catalog.getUnderlyingInstruments(underlying)) {
        if (![InstrumentType.CE, InstrumentType.PE].includes(instrument.instrumentType)) continue;
        if (input.expiry && instrument.expiry?.slice(0,10) !== input.expiry) continue;
        const quote = this.feed.getQuote(instrument.instrumentKey);
        if (!this.fresh(quote, true)) continue;
        const spreadPct = (quote!.askPrice - quote!.bidPrice) / quote!.askPrice * 100;
        if (spreadPct > (input.maxSpreadPct ?? 1) || quote!.volume < (input.minVolume ?? 1000)) continue;
        const liquidityScore = Math.min(100, Math.max(0, 50 - spreadPct * 30) + Math.min(50, quote!.volume / 1000));
        candidates.push({ instrumentKey: instrument.instrumentKey, symbol: instrument.symbol, strikePrice: instrument.strikePrice!, instrumentType: instrument.instrumentType,
          lastPrice: quote!.lastPrice, bidPrice: quote!.bidPrice, askPrice: quote!.askPrice, spreadPct, volume: quote!.volume,
          openInterest: quote!.openInterest, lotSize: instrument.lotSize, liquidityScore });
      }
    }
    candidates.sort((a,b) => b.liquidityScore - a.liquidityScore);
    return { underlying, spotPrice: spot?.lastPrice ?? 0, candidates, timestamp: new Date().toISOString() };
  }

  async calculateIndicators(input: ToolCalculateIndicatorsInput & { requireFreshQuotes?: boolean }): Promise<ToolCalculateIndicatorsOutput> {
    await this.hydrateHistory(input.instrumentKey, input.timeframe);
    const candles = this.getClosedCandles(input.instrumentKey, true, input.timeframe);
    const emaPeriod = input.emaPeriod ?? 20;
    const rsiPeriod = input.rsiPeriod ?? 14;
    const warmup = validateWarmup(candles, emaPeriod, rsiPeriod);
    if (!warmup.isWarmedUp) return { instrumentKey: input.instrumentKey, timeframe: input.timeframe, totalClosedCandles: candles.length,
      isWarmedUp: false, missingWarmupCandles: warmup.missingCandles ?? 0 };
    const closes = candles.map(candle => candle.close);
    const ema = calculateEMA(closes, emaPeriod);
    const rsi = calculateRSI(closes, rsiPeriod);
    const vwap = calculateVWAP(candles);
    return { instrumentKey: input.instrumentKey, timeframe: input.timeframe, totalClosedCandles: candles.length, isWarmedUp: true, missingWarmupCandles: 0,
      lastClosedCandleTime: String(candles[candles.length-1]?.timestamp), ema: ema[ema.length-1], previousEma: ema[ema.length-2],
      rsi: rsi[rsi.length-1], previousRsi: rsi[rsi.length-2], vwap: vwap[vwap.length-1], closePrice: candles[candles.length-1]?.close };
  }

  async evaluateStrategy(strategy: StrategyConfig, instrumentKey: string, _requireFreshQuotes = true): Promise<StrategyEvaluationResult> {
    await this.hydrateHistory(this.underlyingKey(strategy.underlying), strategy.timeframe);
    const candles = this.getClosedCandles(this.underlyingKey(strategy.underlying), true, strategy.timeframe);
    const quote = this.feed.getQuote(instrumentKey);
    const instrument = this.catalog.getInstrument(instrumentKey);
    if (!instrument || !this.fresh(quote, true)) return { passed: false, signal: 'NONE', confidence: 0,
      reasons: ['A listed contract and fresh executable option depth are required.'], metrics: { closedCandlesCount: candles.length, isWarmedUp: false } };
    const currentTimeIst = new Intl.DateTimeFormat('en-GB',{ timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date());
    return evaluateStrategyRules({ strategy, underlyingCandles: candles, candidateQuote: quote!, candidateInstrument: instrument, currentTimeIst });
  }

  getClosedCandles(instrumentKey: string, _verifiedOnly = true, timeframe = '5m'): Candle[] {
    return (this.closedCandles.get(instrumentKey + ':' + timeframe) ?? []).map(candle => ({...candle}));
  }
  /** Warm up only with broker OHLC; a failed response never creates synthetic bars. */
  async hydrateHistory(instrumentKey: string, timeframe = '5m'): Promise<void> {
    if (!this.timeframes.includes(timeframe) || !instrumentKey) return;
    const token = this.tokens?.getToken();
    if (!token || !this.tokens?.hasValidToken() || /^(mock|test|demo)/i.test(token.accessToken)) return;
    const key = instrumentKey + ':' + timeframe;
    if (Date.now() - (this.historyFetchedAt.get(key) ?? 0) < 30000) return;
    const pending = this.historyRequests.get(key);
    if (pending) return pending;
    const request = (async () => {
      const daily = timeframe === '1d';
      const interval = daily ? 1 : strategyTimeframeMinutes(timeframe);
      const unit = daily ? 'days' : 'minutes';
      const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - (daily ? 180 : 10) * 86400000).toISOString().slice(0, 10);
      const base = 'https://api.upstox.com/v3/historical-candle/';
      const suffix = encodeURIComponent(instrumentKey) + '/' + unit + '/' + interval;
      const results = await Promise.allSettled([
        fetch(base + suffix + '/' + today + '/' + from, {headers:{Authorization:'Bearer ' + token.accessToken},signal:AbortSignal.timeout(8000)}),
        fetch(base + 'intraday/' + suffix, {headers:{Authorization:'Bearer ' + token.accessToken},signal:AbortSignal.timeout(8000)}),
      ]);
      const merged = new Map(this.getClosedCandles(instrumentKey, true, timeframe).map(candle => [String(candle.timestamp), candle]));
      let validResponse = false;
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.ok) continue;
        const body = await result.value.json() as {status?:string;data?:{candles?:unknown[][]}};
        if (body.status !== 'success' || !Array.isArray(body.data?.candles)) continue;
        validResponse = true;
        for (const row of body.data.candles) {
          const start = Date.parse(String(row[0]));
          const end = daily ? new Date(start + 330 * 60000).setUTCHours(15, 30, 0, 0) - 330 * 60000 : start + interval * 60000;
          const open=Number(row[1]), high=Number(row[2]), low=Number(row[3]), close=Number(row[4]), volume=Number(row[5]);
          if (!Number.isFinite(start) || end > Date.now() || ![open,high,low,close,volume].every(Number.isFinite) || Math.min(open,high,low,close) <= 0 || volume < 0 || high < Math.max(open,close) || low > Math.min(open,close)) continue;
          const timestamp = new Date(end).toISOString();
          merged.set(timestamp,{timestamp,open,high,low,close,volume});
        }
      }
      if (validResponse) {
        this.closedCandles.set(key,[...merged.values()].sort((a,b)=>Date.parse(String(a.timestamp))-Date.parse(String(b.timestamp))).slice(-500));
        this.historyFetchedAt.set(key,Date.now());
      }
    })();
    this.historyRequests.set(key,request);
    try { await request; } finally { this.historyRequests.delete(key); }
  }
  setClosedCandles(instrumentKey: string, candles: Candle[], timeframe = '5m'): void {
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') throw new AgentSecurityViolationError('Historical injection is restricted to explicit tests. Runtime uses observed closed bars.');
    this.closedCandles.set(instrumentKey + ':' + timeframe, candles.map(candle => ({...candle})));
  }

  private fresh(quote: QuoteSnapshot | undefined, executable: boolean): boolean {
    if (!quote || quote.isStale || quote.lastPrice <= 0) return false;
    const age = Date.now() - Date.parse(quote.timestamp);
    const source = quote.provenance === 'LIVE' || ((process.env.VITEST || process.env.NODE_ENV === 'test') && quote.provenance === 'SIMULATED');
    return Boolean(source) && Number.isFinite(age) && age >= 0 && age <= 3000 &&
      (!executable || (quote.depthKnown === true && quote.bidPrice > 0 && quote.askPrice >= quote.bidPrice && quote.bidQty > 0 && quote.askQty > 0));
  }
  private underlyingKey(underlying: string): string {
    return ({NIFTY:'NSE_INDEX|Nifty 50',BANKNIFTY:'NSE_INDEX|Nifty Bank',FINNIFTY:'NSE_INDEX|Nifty Fin Service',MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT'} as Record<string,string>)[underlying] ?? '';
  }
  private collectClosedCandle(quote: QuoteSnapshot): void {
    if (!quote.instrumentKey.startsWith('NSE_INDEX|') || !this.fresh(quote, false)) return;
    const timestamp = Date.parse(quote.timestamp);
    const localDate = new Date(timestamp + 330 * 60000);
    const minutes = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
    if (minutes < 555 || minutes >= 930) return;
    for (const timeframe of this.timeframes) {
      const duration = strategyTimeframeMinutes(timeframe) * 60000;
      const sessionStart = Date.UTC(localDate.getUTCFullYear(),localDate.getUTCMonth(),localDate.getUTCDate(),3,45);
      const bucket = timeframe === '1d' ? sessionStart : sessionStart + Math.floor((timestamp-sessionStart)/duration)*duration;
      const storeKey = quote.instrumentKey + ':' + timeframe;
      const previous = this.formingCandles.get(storeKey);
      if (previous && bucket < previous.bucket) continue;
      if (!previous || bucket > previous.bucket) {
        if (previous?.complete && bucket === previous.bucket + duration) {
          const bars = this.closedCandles.get(storeKey) ?? [];
          bars.push({...previous.candle,timestamp:new Date(previous.bucket+duration).toISOString()});
          this.closedCandles.set(storeKey,bars.slice(-500));
        }
        this.formingCandles.set(storeKey,{bucket,complete:timestamp-bucket < 3000,volumeAtOpen:quote.volume,
          candle:{timestamp:new Date(bucket+duration).toISOString(),open:quote.lastPrice,high:quote.lastPrice,low:quote.lastPrice,close:quote.lastPrice,volume:0}});
      } else {
        previous.candle.high = Math.max(previous.candle.high,quote.lastPrice);
        previous.candle.low = Math.min(previous.candle.low,quote.lastPrice);
        previous.candle.close = quote.lastPrice;
        previous.candle.volume = Math.max(0,quote.volume-previous.volumeAtOpen);
      }
    }
  }
}
