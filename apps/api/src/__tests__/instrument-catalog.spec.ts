import { describe, it, expect, beforeEach } from 'vitest';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { InstrumentType } from '@trading-bot/contracts';

describe('InstrumentCatalogService', () => {
  let catalog: InstrumentCatalogService;

  beforeEach(() => {
    catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog();
  });

  it('indexes standard spot indexes and option contracts', () => {
    const niftySpot = catalog.getInstrument('NSE_INDEX|Nifty 50');
    expect(niftySpot).toBeDefined();
    expect(niftySpot?.underlying).toBe('NIFTY');
    expect(niftySpot?.lotSize).toBe(25);

    const bankNiftySpot = catalog.getInstrument('NSE_INDEX|Nifty Bank');
    expect(bankNiftySpot).toBeDefined();
    expect(bankNiftySpot?.underlying).toBe('BANKNIFTY');
    expect(bankNiftySpot?.lotSize).toBe(15);
  });

  it('searches instruments by symbol and filters by type', () => {
    const searchResults = catalog.searchInstruments({
      query: '25100 CE',
      underlying: 'NIFTY',
      instrumentType: InstrumentType.CE,
      limit: 10,
    });

    expect(searchResults.length).toBeGreaterThan(0);
    for (const item of searchResults) {
      expect(item.underlying).toBe('NIFTY');
      expect(item.instrumentType).toBe(InstrumentType.CE);
      expect(item.strikePrice).toBe(25100);
    }
  });

  it('extracts available weekly and monthly expiries', () => {
    const expiries = catalog.getAvailableExpiries('NIFTY');
    expect(expiries.length).toBeGreaterThanOrEqual(4);
    expect(expiries[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('constructs aligned Option Chain ladder with matching CE and PE contracts', () => {
    const expiries = catalog.getAvailableExpiries('NIFTY');
    const targetExpiry = expiries[0]!;
    const chain = catalog.buildOptionChain('NIFTY', targetExpiry, 25120.45);

    expect(chain.underlying).toBe('NIFTY');
    expect(chain.spotPrice).toBe(25120.45);
    expect(chain.lotSize).toBe(25);
    expect(chain.strikes.length).toBeGreaterThan(5);

    // Strike 25100 (ATM) should have both call and put present
    const atmRow = chain.strikes.find((s) => s.strikePrice === 25100);
    expect(atmRow).toBeDefined();
    expect(atmRow?.call).toBeDefined();
    expect(atmRow?.put).toBeDefined();
    expect(atmRow?.call?.instrumentKey).toBe(`NSE_FO|NIFTY_${targetExpiry}_25100_CE`);
    expect(atmRow?.put?.instrumentKey).toBe(`NSE_FO|NIFTY_${targetExpiry}_25100_PE`);
  });
});
