import { describe, it, expect } from 'vitest';
import {
  StrategyConfig,
  StrategyStatus,
  TradeMode,
  QuoteSnapshot,
} from '@trading-bot/contracts';
import {
  Candle,
  CandleManager,
  evaluateStrategyRules,
  validateWarmup,
  calculateStrategyVersionHash,
  requiresVersionBump,
} from '../index';

describe('Strategy Evaluator & Rules Engine', () => {
  const baseStrategy: StrategyConfig = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'NIFTY EMA20 RSI Long Call',
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
      rsiThreshold: 55,
      maxBidAskSpreadPct: 1.0,
      minVolume: 1000,
    },
    selection: {
      expiry: 'NEAREST_ELIGIBLE',
      moneyness: 'ATM' as any,
      minVolume: 1000,
    },
    risk: {
      maxCapitalInr: 10000,
      maxAllInTradeLossInr: 500,
      maxAllInDailyLossInr: 1500,
      maxOpenPositions: 1,
      maxTradesPerDay: 3,
      targetNetProfitInr: 300,
      maxRoundTripCostBudgetInr: 60,
    },
    exit: {
      stopBasis: 'OPTION_PREMIUM',
      marketCutoff: '15:10',
    },
    maxCapitalInr: 10000,
    maxAllInTradeLossInr: 500,
    maxAllInDailyLossInr: 1500,
    targetNetProfitInr: 300,
    maxRoundTripCostBudgetInr: 60,
    maxOpenPositions: 1,
    requiresApproval: true,
  };

  const sampleQuote: QuoteSnapshot = {
    instrumentKey: 'NSE_FO|52175',
    lastPrice: 125.0,
    bidPrice: 124.8,
    askPrice: 125.2,
    bidQty: 250,
    askQty: 300,
    volume: 50000,
    openInterest: 150000,
    timestamp: new Date().toISOString(),
    isStale: false,
  };

  function generateCandles(count: number, startPrice = 24000, step = 10): Candle[] {
    const candles: Candle[] = [];
    const baseTime = 1700000000000;
    for (let i = 0; i < count; i++) {
      const price = startPrice + i * step;
      candles.push({
        timestamp: new Date(baseTime + i * 300000).toISOString(),
        open: price - 5,
        high: price + 15,
        low: price - 10,
        close: price,
        volume: 20000 + i * 100,
      });
    }
    return candles;
  }

  it('validates indicator warm-up: rejects evaluation when candles < required period', () => {
    const coldCandles = generateCandles(10); // only 10 candles, EMA-20 needs 20
    const warmup = validateWarmup(coldCandles, 20, 14);
    expect(warmup.isWarmedUp).toBe(false);
    expect(warmup.missingCandles).toBe(10);

    const result = evaluateStrategyRules({
      strategy: baseStrategy,
      underlyingCandles: coldCandles,
      candidateQuote: sampleQuote,
      currentTimeIst: '10:30',
    });

    expect(result.passed).toBe(false);
    expect(result.signal).toBe('NONE');
    expect(result.reasons[0]).toContain('Insufficient warm-up');
    expect(result.metrics.isWarmedUp).toBe(false);
  });

  it('candle-close semantics: in-progress forming candle does not generate signals', () => {
    const manager = new CandleManager({ timeframeMinutes: 5 });
    const t0 = Math.floor(1700000000000 / 300000) * 300000; // start of an aligned 5m window

    // Ticks within same 5m interval update forming candle only
    manager.processTick({ instrumentKey: 'NIFTY', price: 25000, volume: 100, timestamp: t0 + 10000 });
    manager.processTick({ instrumentKey: 'NIFTY', price: 25050, volume: 200, timestamp: t0 + 50000 });
    manager.processTick({ instrumentKey: 'NIFTY', price: 25100, volume: 300, timestamp: t0 + 150000 });

    // In-progress forming candle has high=25100, close=25100
    expect(manager.getFormingCandle()?.close).toBe(25100);
    // Closed candles buffer MUST remain empty until bar confirms
    expect(manager.getClosedCandles().length).toBe(0);

    // Cross into next 5m bucket (t0 + 300,000ms = 5 minutes later)
    const closed = manager.processTick({
      instrumentKey: 'NIFTY',
      price: 25110,
      volume: 150,
      timestamp: t0 + 300000,
    });

    expect(closed).not.toBeNull();
    expect(closed?.close).toBe(25100);
    expect(manager.getClosedCandles().length).toBe(1);
    expect(manager.getClosedCandles()[0]?.close).toBe(25100);
  });

  it('look-ahead bias prevention: out-of-order past ticks are rejected', () => {
    const manager = new CandleManager({ timeframeMinutes: 5 });
    const t0 = 1700000000000;

    manager.processTick({ instrumentKey: 'NIFTY', price: 25000, volume: 100, timestamp: t0 });
    // Advance to next bucket
    manager.processTick({ instrumentKey: 'NIFTY', price: 25100, volume: 100, timestamp: t0 + 300000 });

    // Tick from previous bucket arrives late
    const lateResult = manager.processTick({
      instrumentKey: 'NIFTY',
      price: 99999, // Should NOT affect previous candle
      volume: 50,
      timestamp: t0 + 10000,
    });

    expect(lateResult).toBeNull();
    // Closed candle remains uncorrupted
    expect(manager.getClosedCandles()[0]?.close).toBe(25000);
  });

  it('rejects candidate when bid/ask spread exceeds threshold (> 1.0%)', () => {
    const candles = generateCandles(30, 24000, 15); // Uptrend with 30 candles
    const wideSpreadQuote: QuoteSnapshot = {
      ...sampleQuote,
      bidPrice: 100.0,
      askPrice: 105.0, // spread = 5.0 / 105.0 = 4.76% > 1.0%
    };

    const result = evaluateStrategyRules({
      strategy: baseStrategy,
      underlyingCandles: candles,
      candidateQuote: wideSpreadQuote,
      currentTimeIst: '10:30',
    });

    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('Bid/Ask spread'))).toBe(true);
  });

  it('rejects candidate when volume is below minimum (< 1000)', () => {
    const candles = generateCandles(30, 24000, 15);
    const lowVolumeQuote: QuoteSnapshot = {
      ...sampleQuote,
      volume: 450, // below 1000
    };

    const result = evaluateStrategyRules({
      strategy: baseStrategy,
      underlyingCandles: candles,
      candidateQuote: lowVolumeQuote,
      currentTimeIst: '10:30',
    });

    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('Volume'))).toBe(true);
  });

  it('approves candidate and drafts expiring TradeProposal when all gates pass', () => {
    const candles = generateCandles(30, 24000, 20); // Strong uptrend
    const result = evaluateStrategyRules({
      strategy: baseStrategy,
      underlyingCandles: candles,
      candidateQuote: sampleQuote,
      currentTimeIst: '10:30',
    });

    expect(result.passed).toBe(true);
    expect(result.signal).toBe('BUY_CALL');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.proposal).toBeDefined();

    const proposal = result.proposal!;
    expect(proposal.lotSize).toBe(25); // NIFTY standard lot size
    expect(proposal.quantity).toBe(25);
    expect(proposal.suggestedStopPrice).toBeLessThan(proposal.suggestedEntryPrice);
    expect(proposal.suggestedTargetPrice).toBeGreaterThan(proposal.suggestedEntryPrice);
    expect(proposal.allInMaxLoss).toBeLessThanOrEqual(500); // Trade risk cap
    expect(proposal.estimatedCapitalRequired).toBeLessThanOrEqual(10000); // Capital cap
    expect(new Date(proposal.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('versioning: parameter modifications generate new version hash', () => {
    const initialHash = calculateStrategyVersionHash(baseStrategy);
    expect(initialHash).toMatch(/^v1-[0-9a-f]{8}$/);

    // Minor parameter change (e.g. RSI threshold from 55 to 60)
    const modifiedStrategy: StrategyConfig = {
      ...baseStrategy,
      entry: {
        ...baseStrategy.entry,
        rsiThreshold: 60,
      },
    };

    const newHash = calculateStrategyVersionHash(modifiedStrategy);
    expect(newHash).not.toBe(initialHash);
    expect(requiresVersionBump(baseStrategy, modifiedStrategy)).toBe(true);
  });
});
