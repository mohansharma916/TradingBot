/** Isolated audit observations, not passing acceptance tests. These assertions reproduce
 * defects present at b061edf; replace them with correct-behavior regressions when fixed.
 * All data below is an explicit artificial fixture. No accounts or networks used.
 */
import { describe, it, expect, vi } from 'vitest';
import { runPriceActionMomentumBacktest, aggregateTo5MinuteCandles } from '../../packages/domain/src/price-action-momentum';
import { StrategiesService } from '../../apps/api/src/strategies/strategies.service';
import { fetchRealHistoricalCandles, runStrategyBacktest } from '@trading-bot/domain';

vi.mock('@trading-bot/domain', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  fetchRealHistoricalCandles: vi.fn(async () => ({ candles: [], dataSource: 'AUDIT_STUB' })),
  runStrategyBacktest: vi.fn((options) => options),
}));

const bars = (count: number, start = 10000, step = 10) => Array.from({ length: count }, (_, i) => {
  const open = start + i * step, close = open + step;
  return { timestamp: new Date(Date.parse('2026-10-12T03:45:00Z') + i * 60000).toISOString(),
    open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 };
});
const pamConfig = { candleCount: 4, minimumStructureConfirmations: 1, minimumEfficiency: 0.1,
  stopLossType: 'FIXED_POINTS' as const, stopLossValue: 10,
  targetProfitType: 'FIXED_POINTS' as const, targetPoints: 1000,
  trailingStopEnabled: false, maxTradesPerDay: 1, cooldownMinutes: 0 };
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));

describe('Backtest audit: observations of current defects', () => {
  it('PAM future five-minute direction changes an already decided historical entry', () => {
    const prefix = bars(20);
    const future = bars(20, 10200, -50).map((c, i) => ({ ...c,
      timestamp: new Date(Date.parse('2026-10-12T04:05:00Z') + i * 60000).toISOString() }));
    const config = { ...pamConfig, useMultiTimeframeConfirmation: true };
    const first = runPriceActionMomentumBacktest({ candles: prefix, config });
    const extended = runPriceActionMomentumBacktest({ candles: [...prefix, ...future], config });
    expect(first.trades.length).toBeGreaterThan(0);
    expect(extended.trades.some(t => t.entryTime === first.trades[0]!.entryTime)).toBe(false);
    report('PAM_PREFIX_INVARIANCE_FAILURE', { prefixEntry: first.trades[0]!.entryTime,
      extendedFirstEntry: extended.trades[0]?.entryTime, futureStarts: future[0]!.timestamp });
  });

  it('PAM buys an unaffordable lot and charges push a stop beyond its all-in cap', () => {
    const candles = bars(7);
    candles.push({ ...bars(1)[0]!, timestamp: '2026-10-12T03:52:00Z', open: 9800, high: 9801, low: 9799, close: 9800 });
    const result = runPriceActionMomentumBacktest({ candles, config: pamConfig, initialCapital: 1 });
    const trade = result.trades[0]!;
    expect(trade.entryPrice * trade.quantity).toBeGreaterThan(result.initialCapital);
    expect(-trade.netPnl).toBeGreaterThan(500);
    report('PAM_UNFUNDED_ENTRY_AND_CAP_BREACH', { capital: result.initialCapital,
      premiumRequired: trade.entryPrice * trade.quantity, trade, finalCapital: result.finalCapital });
  });

  it('PAM ignores session start, percentage exits and moneyness selection', () => {
    const candles = bars(12, 22500, 10);
    const base = runPriceActionMomentumBacktest({ candles, config: { ...pamConfig, stopLossValue: 2,
      targetPoints: 2, stopLossType: 'FIXED_POINTS', targetProfitType: 'FIXED_POINTS' } });
    const percentage = runPriceActionMomentumBacktest({ candles, config: { ...pamConfig, stopLossValue: 2,
      targetPoints: 2, stopLossType: 'PERCENTAGE', targetProfitType: 'PERCENTAGE',
      moneyness: 'OTM', strikeOffset: 5, session: { start: '12:00', lastEntry: '12:01', timezone: 'Asia/Kolkata' } } });
    expect(percentage.trades).toEqual(base.trades);
    report('PAM_IGNORED_CONFIG', { firstEntry: base.trades[0]?.entryTime,
      defaultStart: '09:25 IST', suppliedStart: '12:00 IST', sameTradeHistory: true,
      stop: base.trades[0]?.initialStopPrice, entry: base.trades[0]?.entryPrice });
  });

  it('PAM labels a single minute as a completed five-minute candle', () => {
    const result = aggregateTo5MinuteCandles(bars(1));
    expect(result).toHaveLength(1);
    report('PAM_INCOMPLETE_FIVE_MINUTE_BAR', { inputMinutes: 1, outputFiveMinuteBars: result.length });
  });

  it('API silently raises user and strategy loss and cost limits', async () => {
    vi.mocked(runStrategyBacktest).mockClear();
    const service = new StrategiesService(undefined as never, undefined as never, '');
    const strategy = service.getAllStrategies()[0]!;
    Object.assign(strategy, { timeframe: '15m', exit: { ...strategy.exit, stopLossPoints: 10 } });
    await service.runBacktest(strategy.id, { maxTradeLossInr: 100, maxDailyLossInr: 100 });
    const options = vi.mocked(runStrategyBacktest).mock.calls[0]![0];
    expect(options.request?.maxTradeLossInr).toBe(750);
    expect(options.request?.maxDailyLossInr).toBe(1500);
    expect(options.strategy.risk?.maxRoundTripCostBudgetInr).toBe(100);
    expect(options.strategy.risk?.maxAllInTradeLossInr).toBe(750);
    report('API_RISK_OVERRIDES', { requestedTrade: 100, requestedDaily: 100,
      savedTrade: 200, savedDaily: 600, savedCost: 60, testedRisk: options.strategy.risk });
  });

  it('API fetches saved timeframe but schema defaults tell engine a different interval', async () => {
    vi.mocked(runStrategyBacktest).mockClear();
    vi.mocked(fetchRealHistoricalCandles).mockClear();
    const service = new StrategiesService(undefined as never, undefined as never, '');
    const strategy = service.getAllStrategies()[0]!;
    strategy.timeframe = '15m';
    await service.runBacktest(strategy.id, {});
    const fetched = vi.mocked(fetchRealHistoricalCandles).mock.calls[0]![0];
    const tested = vi.mocked(runStrategyBacktest).mock.calls[0]![0];
    expect(fetched.interval).toBe('15m');
    expect(tested.strategy.timeframe).toBe('15m');
    expect(tested.request?.timeframe).toBe('5m');
    report('API_TIMEFRAME_DIVERGENCE', { fetched: fetched.interval, saved: tested.strategy.timeframe,
      engineRequest: tested.request?.timeframe });
  });
});
