import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { StrategiesController } from '../strategies/strategies.controller';
import { StrategiesService } from '../strategies/strategies.service';
import * as domainModule from '@trading-bot/domain';

describe('Strategies Routing & Timeframe Alignment Regression Tests', () => {
  it('declares static PAM routes ahead of parameterized :id routes to prevent Express route shadowing', () => {
    const proto = StrategiesController.prototype as any;
    const methods: { name: string; path: string }[] = [];

    for (const key of Object.getOwnPropertyNames(proto)) {
      const handler = proto[key];
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata('path', handler);
      if (path !== undefined) {
        methods.push({ name: key, path });
      }
    }

    const pamBacktestIndex = methods.findIndex((m) => m.path === 'price-action-momentum/backtest');
    const paramBacktestIndex = methods.findIndex((m) => m.path === ':id/backtest');

    expect(pamBacktestIndex).toBeGreaterThan(-1);
    expect(paramBacktestIndex).toBeGreaterThan(-1);
    expect(pamBacktestIndex).toBeLessThan(paramBacktestIndex);
  });

  it('aligns fetched candle interval with strategy timeframe in StrategiesService.runBacktest', async () => {
    const fetchSpy = vi.spyOn(domainModule, 'fetchRealHistoricalCandles').mockResolvedValue({
      candles: [
        {
          timestamp: '2026-10-05T03:45:00.000Z',
          open: 10000,
          high: 10010,
          low: 9990,
          close: 10005,
          volume: 1000,
        },
      ],
      dataSource: 'MOCK_TEST_UNDERLYING',
    } as any);

    const runSpy = vi.spyOn(domainModule, 'runStrategyBacktest').mockReturnValue({
      strategyId: 'audit_strat',
      strategyName: 'Audit 15m Strategy',
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      netPnl: 0,
      grossPnl: 0,
      totalCharges: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      finalCapital: 10000,
      initialCapital: 10000,
      dataSource: 'MOCK_TEST_UNDERLYING',
      timeframe: '15m',
      trades: [],
      runId: 'bt_run_123',
      dataFingerprint: 'mock_fingerprint',
      effectiveLotSize: 65,
      effectiveTickSize: 0.05,
      effectiveStrategyConfig: {},
      modelAssumptions: [],
    } as any);

    const mockTokens = {
      hasValidToken: vi.fn().mockReturnValue(true),
      getToken: vi.fn().mockReturnValue({ accessToken: 'valid_mock_token' }),
    };

    const service = new StrategiesService(undefined as never, mockTokens as any, '');
    const strategy = service.getAllStrategies()[0]!;
    strategy.timeframe = '15m';

    const result = await service.runBacktest(strategy.id, {
      fromDate: '2026-10-05',
      toDate: '2026-10-05',
      initialCapital: 10000,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const fetchArgs = fetchSpy.mock.calls[0]![0];
    expect(fetchArgs.interval).toBe('15m');

    expect(runSpy).toHaveBeenCalled();
    const runArgs = runSpy.mock.calls[0]![0];
    expect(runArgs.strategy.timeframe).toBe('15m');
    expect(result.timeframe).toBe('15m');

    fetchSpy.mockRestore();
    runSpy.mockRestore();
  });
});
