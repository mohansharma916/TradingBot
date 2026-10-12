import { describe, it, expect } from 'vitest';
import { runStrategyBacktest } from '../backtest-engine';
import { strategyExitLevels, evaluateStrategyRules } from '../strategy-evaluator';
import { calculateOptionCharges } from '../charges';

const config = () => ({
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Accounting audit fixture',
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
    maxTradesPerDay: 10,
    targetNetProfitInr: 300,
    maxRoundTripCostBudgetInr: 200,
  },
  astConfig: {
    direction: 'BULLISH' as const,
    indicators: [],
    bullishEntry: {
      id: 'always',
      operator: 'AND' as const,
      conditions: [{ id: 'signal', left: { type: 'NUMBER' as const, value: 1 }, comparison: 'GT' as const, right: { type: 'NUMBER' as const, value: 0 } }],
    },
    entryRules: { allowReentry: true, cooldownBars: 0 },
    exitRules: {
      stopLossBasis: 'OPTION_PREMIUM' as const,
      stopLossValue: 2,
      targetProfitBasis: 'OPTION_PREMIUM' as const,
      targetProfitValue: 10,
      marketCutoffTime: '15:10',
    },
  },
});

const bars = (count = 6, spot = 10000) =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.parse('2026-10-12T03:45:00Z') + i * 300000).toISOString(),
    open: spot,
    high: spot,
    low: spot,
    close: spot,
    volume: 1000,
  }));

const run = (candles: any[], strategy: any = config(), request: any = {}) =>
  runStrategyBacktest({
    strategy,
    candles,
    request: { initialCapital: 10000, useTrailingStop: false, ...request },
    dataSource: 'ISOLATED_AUDIT_FIXTURE',
    lotSize: 65,
    tickSize: 0.05,
  });

describe('Execution & Accounting Parity Regression Tests', () => {
  it('fills target at known open gap price instead of being stopped by later intrabar low', () => {
    const c = bars(5);
    c[4] = { ...c[4]!, open: 10040, high: 10040, low: 9990, close: 10000 };
    const s = config();
    s.risk.maxTradesPerDay = 1;

    const result = run(c, s);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    expect(trade.exitReason).toBe('TARGET_PROFIT');
    expect(trade.exitPrice).toBe(74.95);
    expect(trade.netPnl).toBeGreaterThan(0);
  });

  it('preserves cumulative daily realized loss without allowing wins to replenish daily budget', () => {
    const c = bars(9);
    c[4] = { ...c[4]!, high: 10025, close: 10025 };
    c[6] = { ...c[6]!, low: 9990 };
    c[8] = { ...c[8]!, low: 9990 };
    const s = config();
    s.risk.maxAllInDailyLossInr = 300;
    s.astConfig.exitRules.stopLossValue = 3;

    const r = run(c, s);
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]!.exitReason).toBe('TARGET_PROFIT');
    expect(r.trades[1]!.exitReason).toBe('STOP_LOSS');
    const losingLoss = Math.abs(r.trades[1]!.netPnl);
    expect(losingLoss).toBeGreaterThan(200);
    // Trade 3 is blocked because remaining daily loss budget is depleted
  });

  it('tracks interim adverse excursion (open-position drawdown) before profitable exit', () => {
    const c = bars(6);
    c[4] = { ...c[4]!, low: 9994, close: 9994 };
    c[5] = { ...c[5]!, high: 10030, close: 10030 };
    const s = config();
    s.risk.maxTradesPerDay = 1;
    s.astConfig.exitRules.stopLossValue = 5;
    s.astConfig.exitRules.targetProfitValue = 20;

    const r = run(c, s);
    expect(r.trades).toHaveLength(1);
    expect(r.netPnl).toBeGreaterThan(0);
    expect(r.maxDrawdown).toBeGreaterThan(200);
    expect(r.maxDrawdownPct).toBeGreaterThan(2.0);
  });

  it('excludes out-of-session bars from final settlement', () => {
    const c = bars(5);
    c[4] = { ...c[4]!, timestamp: '2026-10-12T10:05:00Z', open: 11000, high: 11000, low: 11000, close: 11000 };
    const r = run(c);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.exitPrice).toBe(54.95);
    expect(r.trades[0]!.exitPrice).not.toBe(11000);
  });

  it('rounds fill prices to 0.05 tick grid and ensures exact mathematical PnL agreement', () => {
    const c = bars(4, 22523);
    c[3] = { ...c[3]!, high: 22524.333, close: 22524.333 };
    const s = config();
    s.risk.maxCapitalInr = 10000;

    const r = run(c, s);
    const trade = r.trades[0]!;
    expect(Number((trade.entryPrice % 0.05).toFixed(4)) % 0.05).toBeCloseTo(0, 2);
    expect(Number((trade.exitPrice % 0.05).toFixed(4)) % 0.05).toBeCloseTo(0, 2);
    expect(Math.abs(trade.grossPnl - (trade.exitPrice - trade.entryPrice) * trade.quantity)).toBeLessThan(0.01);
    expect(Math.abs(trade.grossPnl - trade.charges - trade.netPnl)).toBeLessThan(0.01);
  });

  it('reports non-zero genuine profit ratio when all trades win', () => {
    const c = bars(5);
    c[4] = { ...c[4]!, high: 10025, close: 10025 };
    const s = config();
    s.risk.maxTradesPerDay = 1;

    const r = run(c, s);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.exitReason).toBe('TARGET_PROFIT');
    expect(r.profitFactor).toBeGreaterThan(0);
    expect(r.profitFactor).not.toBe(99.99);
  });

  it('blocks target profit execution when estimated round-trip charges result in net loss', () => {
    const s = config();
    s.astConfig.exitRules.targetProfitValue = 0.1;
    s.risk.maxTradesPerDay = 1;
    const c = bars(5);
    c[4] = { ...c[4]!, high: 10001, close: 10001 };

    const r = run(c, s);
    expect(r.trades).toHaveLength(0);
  });
});
