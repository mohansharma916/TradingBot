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
    allowedInstruments: [],
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
      expect(['TARGET_PROFIT', 'STOP_LOSS', 'TIME_CUTOFF']).toContain(trade.exitReason);
    }
  });
});
