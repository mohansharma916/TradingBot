import { Injectable, OnModuleInit } from '@nestjs/common';
import { Instrument, InstrumentType, OptionChainResult, SearchInstrumentsQuery } from '@trading-bot/contracts';
import { getStandardLotSize } from '@trading-bot/domain';

@Injectable()
export class InstrumentCatalogService implements OnModuleInit {
  private instruments: Map<string, Instrument> = new Map();
  private underlyingIndex: Map<string, string[]> = new Map(); // underlying -> instrumentKeys[]

  onModuleInit() {
    this.bootstrapCatalog();
  }

  public bootstrapCatalog(): void {
    // Standard weekly expiries for October/November 2026
    const expiries = ['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'];

    // 1. Index Spot Instruments
    this.addInstrument({
      instrumentKey: 'NSE_INDEX|Nifty 50',
      exchange: 'NSE_INDEX',
      symbol: 'NIFTY 50',
      underlying: 'NIFTY',
      instrumentType: InstrumentType.EQUITY,
      lotSize: 25,
      tickSize: 0.05,
    });

    this.addInstrument({
      instrumentKey: 'NSE_INDEX|Nifty Bank',
      exchange: 'NSE_INDEX',
      symbol: 'BANKNIFTY',
      underlying: 'BANKNIFTY',
      instrumentType: InstrumentType.EQUITY,
      lotSize: 15,
      tickSize: 0.05,
    });

    this.addInstrument({
      instrumentKey: 'NSE_INDEX|Nifty Fin Service',
      exchange: 'NSE_INDEX',
      symbol: 'FINNIFTY',
      underlying: 'FINNIFTY',
      instrumentType: InstrumentType.EQUITY,
      lotSize: 25,
      tickSize: 0.05,
    });

    // 2. Index F&O Option Contracts for NIFTY (Strikes 24800 to 25400)
    const niftyStrikes = [24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300, 25350, 25400];
    for (const expiry of expiries) {
      for (const strike of niftyStrikes) {
        // CE
        const ceKey = `NSE_FO|NIFTY_${expiry}_${strike}_CE`;
        this.addInstrument({
          instrumentKey: ceKey,
          exchange: 'NSE_FO',
          symbol: `NIFTY ${strike} CE ${expiry}`,
          underlying: 'NIFTY',
          instrumentType: InstrumentType.CE,
          strikePrice: strike,
          lotSize: 25,
          tickSize: 0.05,
          expiry: `${expiry}T15:30:00.000Z`,
        });

        // PE
        const peKey = `NSE_FO|NIFTY_${expiry}_${strike}_PE`;
        this.addInstrument({
          instrumentKey: peKey,
          exchange: 'NSE_FO',
          symbol: `NIFTY ${strike} PE ${expiry}`,
          underlying: 'NIFTY',
          instrumentType: InstrumentType.PE,
          strikePrice: strike,
          lotSize: 25,
          tickSize: 0.05,
          expiry: `${expiry}T15:30:00.000Z`,
        });
      }
    }

    // 3. Index F&O Option Contracts for BANKNIFTY (Strikes 51800 to 53000)
    const bankNiftyStrikes = [51800, 52000, 52200, 52400, 52600, 52800, 53000];
    for (const expiry of expiries) {
      for (const strike of bankNiftyStrikes) {
        // CE
        const ceKey = `NSE_FO|BANKNIFTY_${expiry}_${strike}_CE`;
        this.addInstrument({
          instrumentKey: ceKey,
          exchange: 'NSE_FO',
          symbol: `BANKNIFTY ${strike} CE ${expiry}`,
          underlying: 'BANKNIFTY',
          instrumentType: InstrumentType.CE,
          strikePrice: strike,
          lotSize: 15,
          tickSize: 0.05,
          expiry: `${expiry}T15:30:00.000Z`,
        });

        // PE
        const peKey = `NSE_FO|BANKNIFTY_${expiry}_${strike}_PE`;
        this.addInstrument({
          instrumentKey: peKey,
          exchange: 'NSE_FO',
          symbol: `BANKNIFTY ${strike} PE ${expiry}`,
          underlying: 'BANKNIFTY',
          instrumentType: InstrumentType.PE,
          strikePrice: strike,
          lotSize: 15,
          tickSize: 0.05,
          expiry: `${expiry}T15:30:00.000Z`,
        });
      }
    }

    console.log(`[InstrumentCatalog] Indexed ${this.instruments.size} F&O instruments and spot indexes.`);
  }

  private addInstrument(inst: Instrument) {
    this.instruments.set(inst.instrumentKey, inst);
    const existing = this.underlyingIndex.get(inst.underlying) || [];
    if (!existing.includes(inst.instrumentKey)) existing.push(inst.instrumentKey);
    this.underlyingIndex.set(inst.underlying, existing);
  }

  public getInstrument(key: string): Instrument | undefined {
    return this.instruments.get(key);
  }

  public getUnderlyingInstruments(underlying: string): Instrument[] {
    const keys = this.underlyingIndex.get(underlying.toUpperCase()) || [];
    return keys.map((k) => this.instruments.get(k)).filter(Boolean) as Instrument[];
  }

  public searchInstruments(params: SearchInstrumentsQuery): Instrument[] {
    const { query, underlying, instrumentType, limit = 20 } = params;
    const q = query.trim().toUpperCase();

    const results: Instrument[] = [];
    for (const inst of this.instruments.values()) {
      if (underlying && inst.underlying.toUpperCase() !== underlying.toUpperCase()) {
        continue;
      }
      if (instrumentType && inst.instrumentType !== instrumentType) {
        continue;
      }
      if (inst.symbol.toUpperCase().includes(q) || inst.instrumentKey.toUpperCase().includes(q)) {
        results.push(inst);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  public getAvailableExpiries(underlying: string): string[] {
    const keys = this.underlyingIndex.get(underlying.toUpperCase()) || [];
    const expiries = new Set<string>();

    for (const key of keys) {
      const inst = this.instruments.get(key);
      if (inst?.expiry) {
        expiries.add(inst.expiry.split('T')[0]!);
      }
    }

    return Array.from(expiries).sort();
  }

  public buildOptionChain(
    underlying: string,
    expiryDate?: string,
    spotPrice = 25120.45,
    getQuoteFn?: (key: string) => { lastPrice: number; bidPrice: number; askPrice: number; volume: number; openInterest: number; netChangePct: number; isStale: boolean } | undefined,
  ): OptionChainResult {
    const upperUnderlying = underlying.toUpperCase();
    const availableExpiries = this.getAvailableExpiries(upperUnderlying);
    const selectedExpiry = expiryDate || availableExpiries[0] || '2026-10-15';
    const lotSize = getStandardLotSize(upperUnderlying);

    const keys = this.underlyingIndex.get(upperUnderlying) || [];
    const strikeMap = new Map<number, { call?: any; put?: any }>();

    for (const key of keys) {
      const inst = this.instruments.get(key);
      if (!inst || !inst.strikePrice || !inst.expiry) continue;
      if (!inst.expiry.startsWith(selectedExpiry)) continue;

      const strike = inst.strikePrice;
      const current = strikeMap.get(strike) || {};

      const quote = getQuoteFn ? getQuoteFn(key) : undefined;
      const defaultLtp = inst.instrumentType === InstrumentType.CE
        ? Math.max(10, Math.round(150 - (strike - spotPrice) * 0.45))
        : Math.max(10, Math.round(150 + (strike - spotPrice) * 0.45));

      const contractData = {
        instrumentKey: inst.instrumentKey,
        symbol: inst.symbol,
        lastPrice: quote ? quote.lastPrice : defaultLtp,
        bidPrice: quote ? quote.bidPrice : defaultLtp - 0.3,
        askPrice: quote ? quote.askPrice : defaultLtp + 0.3,
        volume: quote ? quote.volume : 54000,
        openInterest: quote ? quote.openInterest : 42000,
        netChangePct: quote ? quote.netChangePct : 1.25,
        isStale: quote ? quote.isStale : false,
      };

      if (inst.instrumentType === InstrumentType.CE) {
        current.call = contractData;
      } else if (inst.instrumentType === InstrumentType.PE) {
        current.put = contractData;
      }

      strikeMap.set(strike, current);
    }

    const strikes = Array.from(strikeMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([strikePrice, data]) => ({
        strikePrice,
        call: data.call,
        put: data.put,
      }));

    return {
      underlying: upperUnderlying,
      spotPrice,
      expiryDate: selectedExpiry,
      availableExpiries,
      lotSize,
      strikes,
      timestamp: new Date().toISOString(),
    };
  }
}
