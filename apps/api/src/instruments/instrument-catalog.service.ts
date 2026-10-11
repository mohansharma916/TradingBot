import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { Instrument, InstrumentType, OptionChainResult, QuoteSnapshot, SearchInstrumentsQuery } from '@trading-bot/contracts';

export const UPSTOX_INSTRUMENT_MASTER_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const UNDERLYING_BY_KEY: Record<string, string> = {
  'NSE_INDEX|Nifty 50': 'NIFTY',
  'NSE_INDEX|Nifty Bank': 'BANKNIFTY',
  'NSE_INDEX|Nifty Fin Service': 'FINNIFTY',
  'NSE_INDEX|NIFTY MID SELECT': 'MIDCPNIFTY',
};

/** Calendar formatting only. Contract expiries come from the broker master. */
export function dateInIst(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

@Injectable()
export class InstrumentCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstrumentCatalogService.name);
  private instruments = new Map<string, Instrument>();
  private loadedAt: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  async onModuleInit(): Promise<void> {
    try { await this.refreshCatalog(); }
    catch (error) { this.logger.error(`Instrument metadata unavailable: ${error instanceof Error ? error.message : 'download failed'}`); }
    this.refreshTimer = setInterval(() => {
      if (!this.getCatalogHealth().available) void this.refreshCatalog().catch(() => {});
    }, 60000);
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void { if (this.refreshTimer) clearInterval(this.refreshTimer); }

  public async refreshCatalog(): Promise<number> {
    const response = await fetch(UPSTOX_INSTRUMENT_MASTER_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Instrument master returned HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const json = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
    return this.bootstrapCatalog(JSON.parse(json.toString('utf8')));
  }

  /** Import broker records. An empty startup cannot create tradable contracts. */
  public bootstrapCatalog(records?: unknown): number {
    if (records === undefined) return this.instruments.size;
    if (!Array.isArray(records)) throw new Error('Instrument master must contain an array.');
    const next = new Map<string, Instrument>();
    for (const raw of records) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const key = row.instrument_key;
      const kind = row.instrument_type;
      if (row.segment !== 'NSE_FO' || (kind !== 'CE' && kind !== 'PE') || typeof key !== 'string' || !/^NSE_FO\|\d+$/.test(key)) continue;
      const underlying = typeof row.underlying_key === 'string' ? UNDERLYING_BY_KEY[row.underlying_key] : undefined;
      if (!underlying || typeof row.trading_symbol !== 'string' || !row.trading_symbol.trim()) continue;
      const lotSize = Number(row.lot_size);
      const tickPaise = Number(row.tick_size);
      const strikePrice = Number(row.strike_price);
      const expiryMs = typeof row.expiry === 'number' ? row.expiry : Date.parse(String(row.expiry));
      if (!Number.isInteger(lotSize) || lotSize <= 0 || !Number.isFinite(tickPaise) || tickPaise <= 0 || !Number.isFinite(strikePrice) || strikePrice <= 0 || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) continue;
      const instrument: Instrument = {
        instrumentKey: key, exchange: 'NSE_FO', symbol: row.trading_symbol,
        underlying, instrumentType: kind === 'CE' ? InstrumentType.CE : InstrumentType.PE,
        strikePrice, lotSize, tickSize: tickPaise / 100, expiry: new Date(expiryMs).toISOString(),
      };
      const duplicate = next.get(key);
      if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(instrument)) throw new Error(`Conflicting metadata for ${key}`);
      next.set(key, instrument);
    }
    if (next.size === 0) throw new Error('Instrument master has no valid, unexpired supported option contracts.');
    this.instruments = next;
    this.loadedAt = new Date().toISOString();
    return next.size;
  }

  public getCatalogHealth(): { available: boolean; loadedAt: string | null; instruments: number } {
    return { available: !!this.loadedAt && dateInIst(new Date(this.loadedAt)) === dateInIst(new Date()), loadedAt: this.loadedAt, instruments: this.instruments.size };
  }

  public getInstrument(key: string): Instrument | undefined {
    const instrument = this.instruments.get(key);
    return this.getCatalogHealth().available && instrument?.expiry && Date.parse(instrument.expiry) > Date.now() ? instrument : undefined;
  }

  public getUnderlyingInstruments(underlying: string): Instrument[] {
    if (!this.getCatalogHealth().available) return [];
    return [...this.instruments.values()].filter((instrument) => instrument.underlying === underlying.toUpperCase() && !!instrument.expiry && Date.parse(instrument.expiry) > Date.now());
  }

  public searchInstruments(params: SearchInstrumentsQuery): Instrument[] {
    if (!this.getCatalogHealth().available) return [];
    const query = params.query.trim().toUpperCase();
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 20));
    return [...this.instruments.values()].filter((instrument) => this.getInstrument(instrument.instrumentKey) &&
      (!params.underlying || instrument.underlying === params.underlying.toUpperCase()) &&
      (!params.instrumentType || instrument.instrumentType === params.instrumentType) &&
      (instrument.symbol.toUpperCase().includes(query) || instrument.instrumentKey.toUpperCase().includes(query))).slice(0, limit);
  }

  public getAvailableExpiries(underlying: string): string[] {
    return [...new Set(this.getUnderlyingInstruments(underlying).map((instrument) => dateInIst(new Date(instrument.expiry!))))].sort();
  }

  public buildOptionChain(underlying: string, expiryDate?: string, spotPrice = 0,
    getQuoteFn?: (key: string) => Partial<QuoteSnapshot> | undefined): OptionChainResult {
    const upper = underlying.toUpperCase();
    const availableExpiries = this.getAvailableExpiries(upper);
    const selectedExpiry = expiryDate || availableExpiries[0] || '';
    const instruments = this.getUnderlyingInstruments(upper).filter((instrument) => dateInIst(new Date(instrument.expiry!)) === selectedExpiry);
    const strikeMap = new Map<number, { call?: any; put?: any }>();
    for (const instrument of instruments) {
      const quote = getQuoteFn?.(instrument.instrumentKey);
      const known = quote && ['LIVE', 'DELAYED', 'SIMULATED'].includes(quote.provenance || '') && Number.isFinite(quote.lastPrice) && Number(quote.lastPrice) > 0;
      const row = strikeMap.get(instrument.strikePrice!) || {};
      const contract = {
        instrumentKey: instrument.instrumentKey, symbol: instrument.symbol,
        lastPrice: known ? quote.lastPrice! : 0, bidPrice: known ? quote.bidPrice || 0 : 0,
        askPrice: known ? quote.askPrice || 0 : 0, volume: known ? quote.volume || 0 : 0,
        openInterest: known ? quote.openInterest || 0 : 0, netChangePct: known ? quote.netChangePct || 0 : 0,
        isStale: !known || quote.isStale !== false, provenance: known ? quote.provenance : 'UNAVAILABLE',
        depthKnown: !!known && quote.depthKnown === true, lotSize: instrument.lotSize,
      };
      if (instrument.instrumentType === InstrumentType.CE) row.call = contract; else row.put = contract;
      strikeMap.set(instrument.strikePrice!, row);
    }
    const lotSizes = new Set(instruments.map((instrument) => instrument.lotSize));
    return {
      underlying: upper, spotPrice: Number.isFinite(spotPrice) && spotPrice > 0 ? spotPrice : 0,
      expiryDate: selectedExpiry, availableExpiries, lotSize: lotSizes.size === 1 ? [...lotSizes][0]! : 0,
      strikes: [...strikeMap].sort(([a], [b]) => a - b).map(([strikePrice, row]) => ({ strikePrice, ...row })),
      timestamp: new Date().toISOString(),
    };
  }
}
