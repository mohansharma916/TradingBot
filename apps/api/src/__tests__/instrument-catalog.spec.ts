import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { InstrumentCatalogService, dateInIst, UPSTOX_INSTRUMENT_MASTER_URL } from '../instruments/instrument-catalog.service';
import { InstrumentType } from '@trading-bot/contracts';

const record = (key = 'NSE_FO|52175', kind = 'CE', lotSize = 65) => ({
  segment: 'NSE_FO', instrument_key: key, instrument_type: kind,
  underlying_key: 'NSE_INDEX|Nifty 50', underlying_symbol: 'NIFTY', trading_symbol: `NIFTY 25100 ${kind} 13 OCT 26`,
  lot_size: lotSize, tick_size: 5, strike_price: 25100, expiry: Date.parse('2026-10-13T18:29:59Z'),
});

describe('InstrumentCatalogService broker metadata', () => {
  let catalog: InstrumentCatalogService;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T06:00:00Z')); catalog = new InstrumentCatalogService(); });
  afterEach(() => { catalog.onModuleDestroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('starts unavailable without inventing contracts, expiries, lot sizes or prices', () => {
    catalog.bootstrapCatalog();
    expect(catalog.getCatalogHealth().available).toBe(false);
    expect(catalog.getUnderlyingInstruments('NIFTY')).toEqual([]);
    expect(catalog.buildOptionChain('NIFTY')).toMatchObject({ spotPrice: 0, lotSize: 0, expiryDate: '', strikes: [] });
  });

  it('uses broker-issued keys, actual lot size, expiry and tick size', () => {
    catalog.bootstrapCatalog([record(), record('NSE_FO|52176', 'PE')]);
    expect(catalog.getInstrument('NSE_FO|52175')).toMatchObject({ lotSize: 65, tickSize: 0.05, expiry: '2026-10-13T18:29:59.000Z' });
    expect(catalog.getAvailableExpiries('NIFTY')).toEqual(['2026-10-13']);
    expect(catalog.searchInstruments({ query: '25100 CE', instrumentType: InstrumentType.CE })).toHaveLength(1);
  });

  it('rejects fabricated keys, expired contracts and invalid metadata', () => {
    for (const invalid of [record('NSE_FO|NIFTY_2026-10-15_25100_CE'), record('NSE_FO|2', 'CE', 0), { ...record(), expiry: 0 }, { ...record(), tick_size: 0 }]) {
      expect(() => catalog.bootstrapCatalog([invalid])).toThrow('no valid');
    }
    expect(catalog.getCatalogHealth().available).toBe(false);
  });

  it('invalidates previous-day metadata rather than reusing stale contract details', () => {
    catalog.bootstrapCatalog([record()]);
    vi.setSystemTime(new Date('2026-10-11T06:00:00Z'));
    expect(catalog.getInstrument('NSE_FO|52175')).toBeUndefined();
    expect(catalog.getAvailableExpiries('NIFTY')).toEqual([]);
  });

  it('does not calculate prices or liquidity for actual contracts without a quote', () => {
    catalog.bootstrapCatalog([record(), record('NSE_FO|52176', 'PE')]);
    const chain = catalog.buildOptionChain('NIFTY', '2026-10-13', 25120.45);
    expect(chain.strikes).toHaveLength(1);
    expect(chain.strikes[0]?.call).toMatchObject({ instrumentKey: 'NSE_FO|52175', lastPrice: 0, bidPrice: 0, askPrice: 0, volume: 0, openInterest: 0, isStale: true, provenance: 'UNAVAILABLE', depthKnown: false });
    expect(chain.lotSize).toBe(65);
  });

  it('rejects unlabelled quote data and preserves delayed source data as stale', () => {
    catalog.bootstrapCatalog([record()]);
    const missing = catalog.buildOptionChain('NIFTY', undefined, 25100, () => ({ lastPrice: 100, volume: 50000 }));
    expect(missing.strikes[0]?.call?.lastPrice).toBe(0);
    const delayed = catalog.buildOptionChain('NIFTY', undefined, 25100, () => ({ lastPrice: 100, provenance: 'DELAYED', isStale: true }));
    expect(delayed.strikes[0]?.call).toMatchObject({ lastPrice: 100, provenance: 'DELAYED', isStale: true });
  });

  it('formats IST expiry dates without relying on the process timezone', () => {
    expect(dateInIst(new Date('2026-10-13T18:29:59Z'))).toBe('2026-10-13');
    expect(dateInIst(new Date('2026-10-13T19:00:00Z'))).toBe('2026-10-14');
  });

  it('loads compressed public broker metadata and remains unavailable on failed startup', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(gzipSync(JSON.stringify([record()]))));
    vi.stubGlobal('fetch', fetch);
    await catalog.onModuleInit();
    expect(fetch).toHaveBeenCalledWith(UPSTOX_INSTRUMENT_MASTER_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(catalog.getCatalogHealth().available).toBe(true);
    const empty = new InstrumentCatalogService();
    fetch.mockRejectedValueOnce(new Error('offline'));
    await empty.onModuleInit();
    expect(empty.getUnderlyingInstruments('NIFTY')).toEqual([]);
    empty.onModuleDestroy();
  });
});
