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

describe('Backtest Phase 1: verified regressions for causality and risk protection', () => {
  it('PAM future five-minute direction does not change an already decided historical entry (prefix-invariance)', () => {
    const prefix = bars(20);
    const future = bars(20, 10200, -50).map((c, i) => ({ ...c,
      timestamp: new Date(Date.parse('2026-10-12T04:05:00Z') + i * 60000).toISOString() }));
    const config = { ...pamConfig, useMultiTimeframeConfirmation: true };
    const first = runPriceActionMomentumBacktest({ candles: prefix, config });
    const extended = runPriceActionMomentumBacktest({ candles: [...prefix, ...future], config });
    expect(first.trades.length).toBeGreaterThan(0);
    expect(extended.trades[0]?.entryTime).toBe(first.trades[0]?.entryTime);
  });

  it('PAM rejects unfunded positions and respects all-in loss cap', () => {
    const candles = bars(7);
    candles.push({ ...bars(1)[0]!, timestamp: '2026-10-12T03:52:00Z', open: 10065, high: 10070, low: 10045, close: 10050 });
    const unfunded = runPriceActionMomentumBacktest({ candles, config: pamConfig, initialCapital: 1 });
    expect(unfunded.trades.length).toBe(0);

    const funded = runPriceActionMomentumBacktest({ candles, config: pamConfig, initialCapital: 10000 });
    expect(funded.trades.length).toBeGreaterThan(0);
    const trade = funded.trades[0]!;
    expect(-trade.netPnl).toBeLessThanOrEqual(500);
  });

  it('PAM does not label a single minute as a completed five-minute candle', () => {
    const result = aggregateTo5MinuteCandles(bars(1));
    expect(result).toHaveLength(0);
  });

  it('API preserves user loss and cost limits without silent inflation', async () => {
    vi.mocked(runStrategyBacktest).mockClear();
    const service = new StrategiesService(undefined as never, undefined as never, '');
    const strategy = service.getAllStrategies()[0]!;
    Object.assign(strategy, { timeframe: '15m', exit: { ...strategy.exit, stopLossPoints: 10 } });
    await service.runBacktest(strategy.id, { maxTradeLossInr: 100, maxDailyLossInr: 100 });
    const options = vi.mocked(runStrategyBacktest).mock.calls[0]![0];
    expect(options.request?.maxTradeLossInr).toBe(100);
    expect(options.request?.maxDailyLossInr).toBe(100);
    expect(options.strategy.risk?.maxRoundTripCostBudgetInr).toBe(60);
    expect(options.strategy.risk?.maxAllInTradeLossInr).toBe(100);
  });

  it('API aligns engine request interval with fetched and saved timeframe', async () => {
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
    expect(tested.request?.timeframe).toBe('15m');
  });
});
