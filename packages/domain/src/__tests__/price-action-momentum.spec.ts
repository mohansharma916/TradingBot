import { describe, it, expect } from 'vitest';
import { Candle } from '../indicators';
import {
  calculatePriceChange,
  calculateTotalMovement,
  calculateTrendEfficiency,
  evaluateMarketStructure,
  aggregateTo5MinuteCandles,
  evaluateMultiTimeframeTrend,
  evaluatePriceActionMomentum,
  runPriceActionMomentumBacktest,
} from '../price-action-momentum';

describe('Price Action Directional Momentum Strategy Unit Tests', () => {
  // Helper to build 6 synthetic candles
  function createBullishCandles(): Candle[] {
    return [
      { timestamp: '2026-03-02T09:15:00.000Z', open: 22000, high: 22020, low: 21990, close: 22010, volume: 1500 },
      { timestamp: '2026-03-02T09:16:00.000Z', open: 22010, high: 22035, low: 22005, close: 22030, volume: 1600 },
      { timestamp: '2026-03-02T09:17:00.000Z', open: 22030, high: 22055, low: 22025, close: 22050, volume: 1800 },
      { timestamp: '2026-03-02T09:18:00.000Z', open: 22050, high: 22070, low: 22045, close: 22065, volume: 1400 },
      { timestamp: '2026-03-02T09:19:00.000Z', open: 22065, high: 22090, low: 22060, close: 22085, volume: 2000 },
      { timestamp: '2026-03-02T09:20:00.000Z', open: 22085, high: 22110, low: 22080, close: 22105, volume: 2200 },
    ];
  }

  function createBearishCandles(): Candle[] {
    return [
      { timestamp: '2026-03-02T09:15:00.000Z', open: 22100, high: 22110, low: 22080, close: 22090, volume: 1500 },
      { timestamp: '2026-03-02T09:16:00.000Z', open: 22090, high: 22095, low: 22060, close: 22070, volume: 1600 },
      { timestamp: '2026-03-02T09:17:00.000Z', open: 22070, high: 22075, low: 22040, close: 22050, volume: 1800 },
      { timestamp: '2026-03-02T09:18:00.000Z', open: 22050, high: 22055, low: 22020, close: 22030, volume: 1400 },
      { timestamp: '2026-03-02T09:19:00.000Z', open: 22030, high: 22035, low: 22000, close: 22010, volume: 2000 },
      { timestamp: '2026-03-02T09:20:00.000Z', open: 22010, high: 22015, low: 21980, close: 21990, volume: 2200 },
    ];
  }

  function createChoppyCandles(): Candle[] {
    return [
      { timestamp: '2026-03-02T09:15:00.000Z', open: 22000, high: 22020, low: 21990, close: 22010, volume: 1500 },
      { timestamp: '2026-03-02T09:16:00.000Z', open: 22010, high: 22015, low: 21980, close: 21985, volume: 1600 },
      { timestamp: '2026-03-02T09:17:00.000Z', open: 21985, high: 22025, low: 21980, close: 22020, volume: 1800 },
      { timestamp: '2026-03-02T09:18:00.000Z', open: 22020, high: 22025, low: 21985, close: 21990, volume: 1400 },
      { timestamp: '2026-03-02T09:19:00.000Z', open: 21990, high: 22030, low: 21985, close: 22015, volume: 2000 },
      { timestamp: '2026-03-02T09:20:00.000Z', open: 22015, high: 22020, low: 21995, close: 22012, volume: 2200 },
    ];
  }

  describe('Phase 2 & 3: Direction & Efficiency Formulas', () => {
    it('correctly calculates bullish priceChange and direction', () => {
      const candles = createBullishCandles();
      const { priceChange, direction } = calculatePriceChange(candles);
      expect(priceChange).toBe(95); // 22105 - 22010
      expect(direction).toBe('BULLISH');
    });

    it('correctly calculates bearish priceChange and direction', () => {
      const candles = createBearishCandles();
      const { priceChange, direction } = calculatePriceChange(candles);
      expect(priceChange).toBe(-100); // 21990 - 22090
      expect(direction).toBe('BEARISH');
    });

    it('handles flat/neutral price action without error', () => {
      const flat = [
        { timestamp: 1, open: 22000, high: 22005, low: 21995, close: 22000, volume: 100 },
        { timestamp: 2, open: 22000, high: 22005, low: 21995, close: 22000, volume: 100 },
      ];
      const { priceChange, direction } = calculatePriceChange(flat);
      expect(priceChange).toBe(0);
      expect(direction).toBe('NEUTRAL');
      expect(calculateTrendEfficiency(priceChange, 0)).toBe(0);
    });

    it('evaluates directional efficiency: straight-line move equals 1.0 (100%)', () => {
      const candles = createBullishCandles();
      const totalMovement = calculateTotalMovement(candles);
      const { priceChange } = calculatePriceChange(candles);
      const efficiency = calculateTrendEfficiency(priceChange, totalMovement);
      // All candles strictly moved up in close: totalMovement === priceChange === 95
      expect(totalMovement).toBe(95);
      expect(efficiency).toBe(1.0);
    });

    it('evaluates directional efficiency on choppy market (< 0.20)', () => {
      const choppy = createChoppyCandles();
      const totalMovement = calculateTotalMovement(choppy);
      const { priceChange } = calculatePriceChange(choppy);
      const efficiency = calculateTrendEfficiency(priceChange, totalMovement);
      expect(priceChange).toBe(2); // 22012 - 22010
      expect(totalMovement).toBeGreaterThan(50);
      expect(efficiency).toBeLessThan(0.20);
    });
  });

  describe('Phase 4: Market Structure Transitions', () => {
    it('counts higher-highs and higher-lows correctly on bullish series', () => {
      const candles = createBullishCandles();
      const structure = evaluateMarketStructure(candles);
      expect(structure.transitionsEvaluated).toBe(5);
      expect(structure.bullishConfirmations).toBe(5);
      expect(structure.bearishConfirmations).toBe(0);
    });

    it('counts lower-highs and lower-lows correctly on bearish series', () => {
      const candles = createBearishCandles();
      const structure = evaluateMarketStructure(candles);
      expect(structure.transitionsEvaluated).toBe(5);
      expect(structure.bearishConfirmations).toBe(5);
      expect(structure.bullishConfirmations).toBe(0);
    });

    it('identifies lack of market structure on choppy data', () => {
      const choppy = createChoppyCandles();
      const structure = evaluateMarketStructure(choppy);
      expect(structure.bullishConfirmations).toBeLessThan(3);
      expect(structure.bearishConfirmations).toBeLessThan(3);
    });
  });

  describe('Phase 5: Multi-Timeframe Confirmation', () => {
    it('aggregates 1-minute candles into 5-minute candles correctly', () => {
      const oneMinCandles: Candle[] = [];
      const baseTime = Date.parse('2026-03-02T09:15:00.000Z');
      for (let i = 0; i < 15; i++) {
        oneMinCandles.push({
          timestamp: new Date(baseTime + i * 60000).toISOString(),
          open: 22000 + i * 5,
          high: 22000 + i * 5 + 4,
          low: 22000 + i * 5 - 2,
          close: 22000 + i * 5 + 3,
          volume: 1000,
        });
      }
      const aggregated5m = aggregateTo5MinuteCandles(oneMinCandles);
      expect(aggregated5m.length).toBe(3); // 15 mins = 3 5m bars
      expect(aggregated5m[0]!.open).toBe(22000);
      expect(aggregated5m[0]!.close).toBe(22023);
    });

    it('validates 5-minute trend direction alignment', () => {
      const fiveMinCandles: Candle[] = [
        { timestamp: '2026-03-02T09:15:00.000Z', open: 22000, high: 22030, low: 21990, close: 22025, volume: 5000 },
        { timestamp: '2026-03-02T09:20:00.000Z', open: 22025, high: 22060, low: 22020, close: 22055, volume: 6000 },
        { timestamp: '2026-03-02T09:25:00.000Z', open: 22055, high: 22090, low: 22050, close: 22080, volume: 7000 },
      ];
      const mtf = evaluateMultiTimeframeTrend(fiveMinCandles, 3);
      expect(mtf.mtfConfirmed).toBe(true);
      expect(mtf.mtfDirection).toBe('BULLISH');
      expect(mtf.mtfPriceChange).toBe(55); // 22080 - 22025
    });
  });

  describe('Phase 6: Trading Signals & Breakout Confirmation', () => {
    it('triggers BUY CE when bullish criteria and upward breakout are verified', () => {
      const candles = createBullishCandles();
      const setupCandleHigh = candles[candles.length - 1]!.high; // 22110
      const livePrice = setupCandleHigh + 5; // 22115 (breakout confirmed)

      const result = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
        config: {
          minimumEfficiency: 0.60,
          minimumStructureConfirmations: 3,
        },
      });

      expect(result.signal).toBe('BUY_CE');
      expect(result.direction).toBe('BULLISH');
      expect(result.breakoutTriggered).toBe(true);
      expect(result.trendEfficiency).toBeGreaterThanOrEqual(0.60);
      expect(result.bullishStructureConfirmations).toBeGreaterThanOrEqual(3);
    });

    it('blocks BUY CE when price does NOT break above setup candle high', () => {
      const candles = createBullishCandles();
      const setupCandleHigh = candles[candles.length - 1]!.high; // 22110
      const livePrice = setupCandleHigh - 2; // 22108 (no breakout)

      const result = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
      });

      expect(result.signal).toBe('NO_TRADE');
      expect(result.breakoutTriggered).toBe(false);
      expect(result.reasons.some((r) => r.includes('Breakout not triggered'))).toBe(true);
    });

    it('triggers BUY PE when bearish criteria and downward breakout are verified', () => {
      const candles = createBearishCandles();
      const setupCandleLow = candles[candles.length - 1]!.low; // 21980
      const livePrice = setupCandleLow - 5; // 21975 (breakout confirmed)

      const result = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
        config: {
          minimumEfficiency: 0.60,
          minimumStructureConfirmations: 3,
        },
      });

      expect(result.signal).toBe('BUY_PE');
      expect(result.direction).toBe('BEARISH');
      expect(result.breakoutTriggered).toBe(true);
      expect(result.trendEfficiency).toBeGreaterThanOrEqual(0.60);
      expect(result.bearishStructureConfirmations).toBeGreaterThanOrEqual(3);
    });

    it('blocks BUY PE when price does NOT break below setup candle low', () => {
      const candles = createBearishCandles();
      const setupCandleLow = candles[candles.length - 1]!.low; // 21980
      const livePrice = setupCandleLow + 2; // 21982 (no breakout)

      const result = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
      });

      expect(result.signal).toBe('NO_TRADE');
      expect(result.breakoutTriggered).toBe(false);
    });

    it('blocks signal when multi-timeframe 5m trend contradicts 1m momentum', () => {
      const candles = createBullishCandles(); // 1m is bullish
      const setupCandleHigh = candles[candles.length - 1]!.high;
      const livePrice = setupCandleHigh + 5;

      // 5m candles are heavily bearish
      const opposing5m: Candle[] = [
        { timestamp: '2026-03-02T09:15:00.000Z', open: 22150, high: 22160, low: 22100, close: 22120, volume: 5000 },
        { timestamp: '2026-03-02T09:20:00.000Z', open: 22120, high: 22125, low: 22050, close: 22060, volume: 6000 },
      ];

      const result = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        fiveMinuteCandles: opposing5m,
        currentPrice: livePrice,
        config: {
          useMultiTimeframeConfirmation: true,
        },
      });

      expect(result.signal).toBe('NO_TRADE');
      expect(result.mtfConfirmed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Multi-timeframe disagreement'))).toBe(true);
    });

    it('prevents duplicate signals on the exact same setup candle timestamp', () => {
      const candles = createBullishCandles();
      const setupCandle = candles[candles.length - 1]!;
      const livePrice = setupCandle.high + 5;

      const firstEval = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
      });
      expect(firstEval.signal).toBe('BUY_CE');

      const secondEval = evaluatePriceActionMomentum({
        oneMinuteCandles: candles,
        currentPrice: livePrice,
        lastSignalTimestamp: setupCandle.timestamp,
      });
      expect(secondEval.signal).toBe('NO_TRADE');
      expect(secondEval.reasons.some((r) => r.includes('Duplicate signal prevention'))).toBe(true);
    });
  });

  describe('Phase 9: Backtesting Engine Validation', () => {
    it('runs historical backtest and computes comprehensive quantitative metrics', () => {
      // Build 60 synthetic 1m intraday candles
      const candles: Candle[] = [];
      const baseTime = Date.parse('2026-03-02T09:15:00.000Z');
      let currentClose = 22000;

      for (let i = 0; i < 60; i++) {
        const move = i < 20 ? 10 : i < 40 ? -8 : 12; // 3 clear trend swings
        currentClose += move;
        candles.push({
          timestamp: new Date(baseTime + i * 60000).toISOString(),
          open: currentClose - move,
          high: currentClose + 5,
          low: currentClose - 5,
          close: currentClose,
          volume: 1500,
        });
      }

      const backtest = runPriceActionMomentumBacktest({
        candles,
        config: {
          candleCount: 6,
          minimumEfficiency: 0.60,
          minimumStructureConfirmations: 3,
        },
        initialCapital: 10000,
      });

      expect(backtest.strategyId).toBe('tpl_price_action_momentum');
      expect(backtest.initialCapital).toBe(10000);
      expect(backtest.totalTrades).toBeGreaterThanOrEqual(1);
      expect(backtest.winRatePct).toBeGreaterThanOrEqual(0);
      expect(backtest.winRatePct).toBeLessThanOrEqual(100);
      expect(backtest.totalCharges).toBeGreaterThan(0); // Real statutory charges deducted
      expect(Number.isFinite(backtest.expectancy)).toBe(true);
      expect(Number.isFinite(backtest.profitFactor)).toBe(true);
    });
  });
});
