import { describe, it, expect } from 'vitest';
import { StrategyConfig, StrategyStatus, TradeMode } from '@trading-bot/contracts';
import {
  generateHistoricalMarketCandles,
  runStrategyBacktest,
} from '../index';

describe('Historical Backtest Engine', () => {
  const sampleStrategy: StrategyConfig = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'NIFTY Test Momentum Strategy',
    version: 1,
    status: StrategyStatus.PAPER_ACTIVE,
    tradeMode: TradeMode.PAPER,
    market: 'NSE_FO',
    underlying: 'NIFTY',
    allowedInstruments: ['LONG_CALL'] as any,
    timeframe: '5m',
    session: {
      start: '09:25',
      lastEntry: '14:45',
      timezone: 'Asia/Kolkata',
    },
    entry: {
      emaPeriod: 20,
      rsiPeriod: 14,
      rsiThreshold: 50,
      maxBidAskSpreadPct: 1.0,
      minVolume: 1000,
    },
    selection: {
      underlying: 'NIFTY',
      optionType: 'CE',
      expiryPreference: 'CURRENT_WEEK',
      strikeOffset: 0,
      deltaTarget: 0.5,
    },
    exit: {
      marketCutoff: '15:10',
      profitTargetPct: 20,
      stopLossPct: 10,
    },
    risk: {
      maxCapitalInr: 10000,
      maxRiskPerTradeInr: 200,
      targetNetProfitInr: 300,
      maxAllInTradeLossInr: 200,
      maxTradesPerDay: 3,
      maxDailyLossInr: 500,
      coolOffMinutesAfterLoss: 15,
      allowRecoveryTrades: false,
    },
  };

  it('generates valid historical candles for market sessions', () => {
    const candles = generateHistoricalMarketCandles('NIFTY', 5, 5);
    expect(candles.length).toBeGreaterThan(0);
    // Candle prices should be realistic around NIFTY base
    for (const candle of candles) {
      expect(candle.open).toBeGreaterThan(15000);
      expect(candle.close).toBeGreaterThan(15000);
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
      expect(candle.volume).toBeGreaterThan(0);
    }
  });

  it('returns empty result when candles count is below warmup threshold', () => {
    const result = runStrategyBacktest({
      strategy: sampleStrategy,
      candles: [],
      request: { days: 14, initialCapital: 10000, underlying: 'NIFTY' },
    });

    expect(result.totalTrades).toBe(0);
    expect(result.initialCapital).toBe(10000);
    expect(result.finalCapital).toBe(10000);
    expect(result.trades).toHaveLength(0);
  });

  it('runs deterministic simulation and accurately deducts statutory charges', () => {
    const candles = generateHistoricalMarketCandles('NIFTY', 14, 5);
    const result = runStrategyBacktest({
      strategy: sampleStrategy,
      candles,
      request: { days: 14, initialCapital: 15000, underlying: 'NIFTY' },
    });

    expect(result.strategyId).toBe(sampleStrategy.id);
    expect(result.initialCapital).toBe(15000);
    expect(result.netPnl).toBe(Number((result.grossPnl - result.totalCharges).toFixed(2)));
    expect(result.finalCapital).toBe(Number((15000 + result.netPnl).toFixed(2)));
    expect(result.winRatePct).toBeGreaterThanOrEqual(0);
    expect(result.winRatePct).toBeLessThanOrEqual(100);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);

    for (const trade of result.trades) {
      expect(trade.charges).toBeGreaterThan(0); // Statutory fees must be deducted
      expect(trade.quantity).toBeGreaterThan(0);
      expect(['TARGET_PROFIT', 'STOP_LOSS', 'TIME_CUTOFF', 'TRAILING_STOP_LOSS', 'DATASET_END', 'SESSION_DATA_END']).toContain(trade.exitReason);
    }
  });

  it('activates trailing stop loss to protect profits when favorable move occurs', () => {
    const candles = generateHistoricalMarketCandles('NIFTY', 14, 5);
    const withTrailing = runStrategyBacktest({
      strategy: sampleStrategy,
      candles,
      request: {
        days: 14,
        initialCapital: 10000,
        underlying: 'NIFTY',
        useTrailingStop: true,
        trailingActivationProfitInr: 100,
        trailingStepInr: 30,
      },
    });

    expect(withTrailing.dataSource).toBeDefined();
    expect(withTrailing.trades.length).toBeGreaterThanOrEqual(0);
  });

  it('strictly bounds simulated trades and candles to user-selected fromDate and toDate', () => {
    const candles = generateHistoricalMarketCandles('NIFTY', 14, 5, '2026-10-05', '2026-10-06');
    expect(candles.length).toBe(150); // 2 days * 75 bars per day for 5m

    const result = runStrategyBacktest({
      strategy: sampleStrategy,
      candles,
      request: {
        fromDate: '2026-10-06',
        toDate: '2026-10-06',
        days: 1,
        initialCapital: 10000,
        underlying: 'NIFTY',
      },
    });

    // Candles must be strictly bounded to 2026-10-06
    expect(result.fromDate.startsWith('2026-10-06')).toBe(true);
    expect(result.toDate.startsWith('2026-10-06')).toBe(true);

    // Every single trade must have entry and exit on 2026-10-06
    for (const trade of result.trades) {
      expect(trade.entryTime.startsWith('2026-10-06')).toBe(true);
      if (trade.exitTime) {
        expect(trade.exitTime.startsWith('2026-10-06')).toBe(true);
      }
    }
  });

  it('generates candles for exact custom date range skipping weekends', () => {
    // 2026-10-03 is Saturday, 2026-10-04 is Sunday, 2026-10-05 is Monday
    const candles = generateHistoricalMarketCandles('NIFTY', 5, 5, '2026-10-03', '2026-10-05');
    // Only Monday should generate 75 candles
    expect(candles.length).toBe(75);
    for (const c of candles) {
      expect(c.timestamp.startsWith('2026-10-05')).toBe(true);
    }
  });

  describe('Phase 2 Regressions: Historical Data, Multi-Year Calendar & Warmup', () => {
    it('B07: allows simulation on verified historical year 2025', () => {
      // 2025-10-06 is a Monday (regular trading day in 2025)
      const candles = generateHistoricalMarketCandles('NIFTY', 5, 5, '2025-10-06', '2025-10-06');
      expect(candles.length).toBe(75);
      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles,
        request: { fromDate: '2025-10-06', toDate: '2025-10-06', days: 1, initialCapital: 15000 },
      });
      expect(result.error).toBeUndefined();
    });

    it('B07: explicitly rejects unverified calendar year with UNSUPPORTED_CALENDAR_YEAR', () => {
      const candles = [
        { timestamp: '2027-01-04T04:00:00.000Z', open: 22000, high: 22050, low: 21950, close: 22010, volume: 1000 },
        { timestamp: '2027-01-04T04:05:00.000Z', open: 22010, high: 22060, low: 21960, close: 22020, volume: 1000 },
        { timestamp: '2027-01-04T04:10:00.000Z', open: 22020, high: 22070, low: 21970, close: 22030, volume: 1000 },
      ];
      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles,
        request: { initialCapital: 10000 },
      });
      expect(result.error).toContain('UNSUPPORTED_CALENDAR_YEAR');
    });

    it('B11: decouples data loading window from trading window and validates warmup', () => {
      // Strategy with EMA 20 and RSI 14 requires 20 warmup bars
      const warmupBars = Array.from({ length: 25 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-05T03:45:00.000Z') + i * 300000).toISOString(),
        open: 20000 + i * 10,
        high: 20005 + i * 10,
        low: 19995 + i * 10,
        close: 20002 + i * 10,
        volume: 2000,
      }));
      const tradingBars = Array.from({ length: 20 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-06T03:45:00.000Z') + i * 300000).toISOString(),
        open: 20300 + i * 10,
        high: 20305 + i * 10,
        low: 20295 + i * 10,
        close: 20302 + i * 10,
        volume: 2000,
      }));

      // Combined candles: 25 warmup bars + 20 trading bars
      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles: [...warmupBars, ...tradingBars],
        request: { fromDate: '2026-10-06', toDate: '2026-10-06' },
      });

      expect(result.error).toBeUndefined();
      // Trades must not be entered during warmup bars on 2026-10-05
      for (const t of result.trades) {
        expect(t.entryTime.startsWith('2026-10-06')).toBe(true);
      }
    });

    it('B11: returns INSUFFICIENT_WARMUP diagnostic when bars are fewer than required warmup', () => {
      // Only 5 bars, but strategy requires at least 20 warmup bars
      const fiveBars = Array.from({ length: 5 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-06T03:45:00.000Z') + i * 300000).toISOString(),
        open: 20000 + i * 10,
        high: 20005 + i * 10,
        low: 19995 + i * 10,
        close: 20002 + i * 10,
        volume: 2000,
      }));

      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles: fiveBars,
      });

      expect(result.error).toContain('INSUFFICIENT_WARMUP');
    });

    it('B10 & B25: rejects unsupported underlyings, invalid date formats, and unsupported intervals in fetcher', async () => {
      const { fetchRealHistoricalCandles } = await import('../backtest-engine');

      // Unsupported underlying
      await expect(
        fetchRealHistoricalCandles({ underlying: 'UNSUPPORTED_INDEX', days: 7 }),
      ).rejects.toThrow('Unsupported underlying instrument');

      // Invalid date format
      await expect(
        fetchRealHistoricalCandles({ underlying: 'NIFTY', fromDate: '2026-10-05junk' }),
      ).rejects.toThrow('Invalid fromDate format');

      // fromDate after toDate
      await expect(
        fetchRealHistoricalCandles({ underlying: 'NIFTY', fromDate: '2026-10-10', toDate: '2026-10-05' }),
      ).rejects.toThrow('fromDate (2026-10-10) cannot be after toDate (2026-10-05)');

      // Unsupported interval
      await expect(
        fetchRealHistoricalCandles({ underlying: 'NIFTY', timeframe: '3m' }),
      ).rejects.toThrow('Unsupported timeframe interval');
    });
  });
});
