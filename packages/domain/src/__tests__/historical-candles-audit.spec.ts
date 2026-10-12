import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchRealHistoricalCandles, runStrategyBacktest } from '../backtest-engine';

describe('Historical Candles & Multi-Year Calendar Regression Tests', () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; signal: boolean }[] = [];
  const makeRows = (stepMinutes = 5, start = '2026-10-05T03:45:00Z', count = 20) =>
    Array.from({ length: count }, (_, i) => [
      new Date(Date.parse(start) + i * stepMinutes * 60000).toISOString(),
      10000 + i,
      10002 + i,
      9999 + i,
      10001 + i,
      1000,
      0,
    ]);

  let rows = makeRows();

  beforeEach(() => {
    calls.length = 0;
    rows = makeRows();
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input);
      calls.push({ url, signal: Boolean(init?.signal) });
      if (url.includes('upstox')) {
        return { ok: true, json: async () => ({ status: 'success', data: { candles: rows } }) } as any;
      }
      return {
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                timestamp: rows.map((r) => Date.parse(r[0] as string) / 1000),
                indicators: {
                  quote: [
                    {
                      open: rows.map((r) => r[1]),
                      high: rows.map((r) => r[2]),
                      low: rows.map((r) => r[3]),
                      close: rows.map((r) => r[4]),
                      volume: rows.map((r) => r[5]),
                    },
                  ],
                },
              },
            ],
          },
        }),
      } as any;
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps FINNIFTY and MIDCPNIFTY to proper Upstox instrument keys without aliasing to NIFTY', async () => {
    const finnifty = await fetchRealHistoricalCandles({
      underlying: 'FINNIFTY',
      timeframe: '5m',
      fromDate: '2026-10-05',
      toDate: '2026-10-05',
      authToken: 'fake-token',
    });
    expect(calls[0]?.url).toContain('NSE_INDEX%7CNifty%20Fin%20Service');
    expect(finnifty.candles.length).toBeGreaterThan(0);

    calls.length = 0;
    const midcpnifty = await fetchRealHistoricalCandles({
      underlying: 'MIDCPNIFTY',
      timeframe: '5m',
      fromDate: '2026-10-05',
      toDate: '2026-10-05',
      authToken: 'fake-token',
    });
    expect(calls[0]?.url).toContain('NSE_INDEX%7CNIFTY%20MID%20SELECT');
    expect(midcpnifty.candles.length).toBeGreaterThan(0);
  });

  it('rejects unsupported timeframe intervals with descriptive error', async () => {
    await expect(
      fetchRealHistoricalCandles({
        underlying: 'NIFTY',
        timeframe: '3m' as any,
        fromDate: '2026-10-05',
        toDate: '2026-10-05',
        authToken: 'fake-token',
      })
    ).rejects.toThrow('Unsupported timeframe interval: "3m"');
  });

  it('rejects malformed date formats strictly', async () => {
    await expect(
      fetchRealHistoricalCandles({
        underlying: 'NIFTY',
        fromDate: '2026-10-05junk',
        toDate: '2026-10-05',
        authToken: 'fake-token',
      })
    ).rejects.toThrow('Invalid fromDate format: "2026-10-05junk". Expected YYYY-MM-DD.');
  });

  it('replays trading sessions across multiple calendar years (2025 and 2026)', () => {
    const strategy: any = {
      id: 'calendar_test',
      name: 'Calendar Test',
      version: 1,
      underlying: 'NIFTY',
      timeframe: '5m',
      allowedInstruments: ['LONG_CALL'],
      session: { start: '09:15', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      risk: {
        maxCapitalInr: 4000,
        maxAllInTradeLossInr: 500,
        maxAllInDailyLossInr: 1500,
        maxOpenPositions: 1,
        maxTradesPerDay: 3,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 200,
      },
      astConfig: {
        direction: 'BULLISH',
        indicators: [],
        bullishEntry: {
          id: 'always',
          operator: 'AND',
          conditions: [{ id: 'signal', left: { type: 'NUMBER', value: 1 }, comparison: 'GT', right: { type: 'NUMBER', value: 0 } }],
        },
        entryRules: { allowReentry: true, cooldownBars: 0 },
        exitRules: { stopLossBasis: 'OPTION_PREMIUM', stopLossValue: 2, targetProfitBasis: 'OPTION_PREMIUM', targetProfitValue: 10, marketCutoffTime: '15:10' },
      },
    };

    const asCandles = (data: any[]) =>
      data.map((r) => ({ timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));

    for (const date of ['2025-10-06', '2026-10-05']) {
      const res = runStrategyBacktest({
        strategy,
        candles: asCandles(makeRows(5, `${date}T03:45:00Z`)),
        request: { initialCapital: 10000, useTrailingStop: false },
        dataSource: 'LOCAL_STUB_UNDERLYING',
      });
      expect(res.error).toBeUndefined();
      expect(res.totalTrades).toBeGreaterThan(0);
    }
  });

  it('returns INSUFFICIENT_WARMUP diagnostic when candle count is less than indicator period', () => {
    const strategy: any = {
      id: 'warmup_test',
      name: 'Warmup Test',
      version: 1,
      underlying: 'NIFTY',
      timeframe: '5m',
      allowedInstruments: ['LONG_CALL'],
      session: { start: '09:15', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      risk: {
        maxCapitalInr: 4000,
        maxAllInTradeLossInr: 500,
        maxAllInDailyLossInr: 1500,
        maxOpenPositions: 1,
        maxTradesPerDay: 3,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 200,
      },
      astConfig: {
        direction: 'BULLISH',
        indicators: [{ id: 'ema30', type: 'EMA', period: 30, source: 'CLOSE' }],
        bullishEntry: {
          id: 'always',
          operator: 'AND',
          conditions: [{ id: 'signal', left: { type: 'INDICATOR', indicatorId: 'ema30' }, comparison: 'GT', right: { type: 'NUMBER', value: 0 } }],
        },
        entryRules: { allowReentry: true, cooldownBars: 0 },
        exitRules: { stopLossBasis: 'OPTION_PREMIUM', stopLossValue: 2, targetProfitBasis: 'OPTION_PREMIUM', targetProfitValue: 10, marketCutoffTime: '15:10' },
      },
    };

    const asCandles = (data: any[]) =>
      data.map((r) => ({ timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));

    const res = runStrategyBacktest({
      strategy,
      candles: asCandles(makeRows(5, '2026-10-05T03:45:00Z', 20)),
      request: { initialCapital: 10000, useTrailingStop: false },
    });
    expect(res.error).toContain('INSUFFICIENT_WARMUP');
    expect(res.totalTrades).toBe(0);
  });
});
