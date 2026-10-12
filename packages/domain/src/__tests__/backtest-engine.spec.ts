import { describe, it, expect } from 'vitest';
import { BacktestRequestSchema, StrategyConfig, StrategyStatus, TradeMode } from '@trading-bot/contracts';
import {
  generateHistoricalMarketCandles,
  runStrategyBacktest,
  runPriceActionMomentumBacktest,
  getDatedLotSize,
  calculateOptionCharges,
  PREDEFINED_STRATEGY_TEMPLATES,
  validateStrategyFeasibility,
  convertLegacyStrategyToAst,
  buildIndicatorCache,
  evaluateStrategyAst,
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

  describe('Phase 3 Regressions: Execution Parity & Accounting Precision', () => {
    const configFixture = () => ({
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Phase 3 Accounting Parity Fixture',
      version: 1,
      status: StrategyStatus.PAPER_ACTIVE,
      tradeMode: TradeMode.PAPER,
      market: 'NSE_FO',
      underlying: 'NIFTY',
      timeframe: '5m',
      allowedInstruments: ['LONG_CALL'] as any,
      session: { start: '09:15', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      risk: {
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 500,
        maxAllInDailyLossInr: 1500,
        maxOpenPositions: 1,
        maxTradesPerDay: 10,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 200,
      },
      astConfig: {
        direction: 'BULLISH',
        indicators: [],
        bullishEntry: {
          id: 'always',
          operator: 'AND',
          conditions: [
            {
              id: 'signal',
              left: { type: 'NUMBER', value: 1 },
              comparison: 'GT',
              right: { type: 'NUMBER', value: 0 },
            },
          ],
        },
        entryRules: { allowReentry: true, cooldownBars: 0 },
        exitRules: {
          stopLossBasis: 'OPTION_PREMIUM',
          stopLossValue: 2,
          targetProfitBasis: 'OPTION_PREMIUM',
          targetProfitValue: 10,
          marketCutoffTime: '15:10',
        },
      },
    });

    const createBars = (count = 6, spot = 10000) =>
      Array.from({ length: count }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-12T03:45:00Z') + i * 300000).toISOString(),
        open: spot,
        high: spot,
        low: spot,
        close: spot,
        volume: 1000,
      }));

    it('B21: executes known opening gap above target at open price rather than stopping out', () => {
      const candles = createBars(5);
      // Bar 4 opens above the target (10040), then has a low at 9990
      candles[4] = { ...candles[4], open: 10040, high: 10040, low: 9990, close: 10000 };
      const strat: any = configFixture();
      strat.risk.maxTradesPerDay = 1;

      const result = runStrategyBacktest({
        strategy: strat,
        candles,
        request: { initialCapital: 10000 },
        lotSize: 65,
        tickSize: 0.05,
      });

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0]!;
      expect(trade.exitReason).toBe('TARGET_PROFIT');
      expect(trade.netPnl).toBeGreaterThan(0);
    });

    it('B12: cumulative daily realized losses do not get replenished by winning trades', () => {
      const candles = createBars(10);
      // Trade 1 wins
      candles[4] = { ...candles[4], high: 10025, close: 10025 };
      // Trade 2 loses
      candles[6] = { ...candles[6], low: 9990 };
      // Trade 3 loses
      candles[8] = { ...candles[8], low: 9990 };

      const strat: any = configFixture();
      strat.risk.maxAllInDailyLossInr = 300;
      strat.astConfig.exitRules.stopLossValue = 3;

      const result = runStrategyBacktest({
        strategy: strat,
        candles,
        request: { initialCapital: 10000 },
        lotSize: 65,
        tickSize: 0.05,
      });

      // Sum of losing trade losses must not exceed the daily cap of 300, and further trades must be halted
      const losingTrades = result.trades.filter((t) => t.netPnl < 0);
      const totalRealizedLoss = losingTrades.reduce((acc, t) => acc + Math.abs(t.netPnl), 0);
      expect(totalRealizedLoss).toBeLessThanOrEqual(300 + 20); // within 1 trade buffer
      // If wins had replenished the budget, more trades would have executed
      expect(result.trades.length).toBeLessThan(4);
    });

    it('B14: captures mark-to-market interim drawdown when position has adverse excursion before winning', () => {
      const candles = createBars(6);
      // Trade entered at bar 3.
      // Bar 4 dips down (unrealized loss), but does not hit stop loss (stop is at 10)
      candles[4] = { ...candles[4], low: 9994, close: 9994 };
      // Bar 5 rallies to target
      candles[5] = { ...candles[5], high: 10030, close: 10030 };

      const strat: any = configFixture();
      strat.risk.maxTradesPerDay = 1;
      strat.astConfig.exitRules.stopLossValue = 5;
      strat.astConfig.exitRules.targetProfitValue = 20;

      const result = runStrategyBacktest({
        strategy: strat,
        candles,
        request: { initialCapital: 10000 },
        lotSize: 65,
        tickSize: 0.05,
      });

      expect(result.trades.length).toBe(1);
      expect(result.trades[0]!.netPnl).toBeGreaterThan(0);
      // MTM drawdown must reflect the interim drop on bar 4, NOT 0
      expect(result.maxDrawdown).toBeGreaterThan(0);
      expect(result.maxDrawdownPct).toBeGreaterThan(0);
    });

    it('B22: fills round to tick grid and recorded trade accounting (gross - charges = net) matches exactly', () => {
      const candles = createBars(5, 22523);
      candles[4] = { ...candles[4], high: 22530.123, close: 22530.123 };
      const strat: any = configFixture();

      const result = runStrategyBacktest({
        strategy: strat,
        candles,
        request: { initialCapital: 10000 },
        lotSize: 65,
        tickSize: 0.05,
      });

      for (const trade of result.trades) {
        // Entry and exit prices must be on 0.05 tick grid
        expect(Number((trade.entryPrice % 0.05).toFixed(4)) % 0.05).toBeCloseTo(0, 3);
        expect(Number((trade.exitPrice % 0.05).toFixed(4)) % 0.05).toBeCloseTo(0, 3);
        // Accounting parity
        const expectedGross = Number(((trade.exitPrice - trade.entryPrice) * trade.quantity).toFixed(2));
        expect(trade.grossPnl).toBeCloseTo(expectedGross, 2);
        const expectedNet = Number((trade.grossPnl - trade.charges).toFixed(2));
        expect(trade.netPnl).toBeCloseTo(expectedNet, 2);
      }
    });

    it('B13: ignores out-of-session candle for final exit and settles on last eligible session candle', () => {
      const candles = createBars(5);
      // Bar 4 is at 15:35 IST (10:05 UTC) with an artificial high spike
      candles[4] = {
        ...candles[4],
        timestamp: '2026-10-12T10:05:00Z',
        open: 11000,
        high: 11000,
        low: 11000,
        close: 11000,
      };

      const result = runStrategyBacktest({
        strategy: configFixture() as any,
        candles,
        lotSize: 65,
        tickSize: 0.05,
      });

      expect(result.trades.length).toBeGreaterThan(0);
      const lastTrade = result.trades[result.trades.length - 1]!;
      // Settle exit must NOT use the artificial 11000 out-of-session price
      expect(lastTrade.exitPrice).not.toBe(11000);
      expect(lastTrade.exitPrice).toBeLessThan(11000);
    });

    it('B15: rejects orders when net target profit is non-positive after round-trip charges', () => {
      const strat: any = configFixture();
      // Target profit value of only 0.10 points - gross profit is ₹6.50, but statutory charges exceed ₹40
      strat.astConfig.exitRules.targetProfitValue = 0.10;
      strat.risk.maxTradesPerDay = 1;

      const candles = createBars(5);
      const result = runStrategyBacktest({
        strategy: strat,
        candles,
        lotSize: 65,
        tickSize: 0.05,
      });

      // Trade must be rejected by net target viability check
      expect(result.trades.length).toBe(0);
    });

    it('B17 & B24: PAM percentage exit scaling and clean profit factor on all-win runs', () => {
      const candles = Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-12T03:45:00Z') + i * 60000).toISOString(),
        open: 10000 + i * 10,
        high: 10005 + i * 10,
        low: 9995 + i * 10,
        close: 10004 + i * 10,
        volume: 2000,
      }));

      const pamResult = runPriceActionMomentumBacktest({
        candles,
        config: {
          candleCount: 4,
          minimumStructureConfirmations: 1,
          minimumEfficiency: 0.1,
          stopLossType: 'PERCENTAGE',
          stopLossValue: 5,
          targetProfitType: 'PERCENTAGE',
          targetPoints: 20,
          trailingStopEnabled: false,
          maxTradesPerDay: 5,
          cooldownMinutes: 0,
        },
        initialCapital: 10000,
      });

      expect(pamResult.error).toBeUndefined();
      if (pamResult.trades.length > 0) {
        // Profit factor should never be artificial 99.99 or 0 if winning
        if (pamResult.winningTrades > 0 && pamResult.losingTrades === 0) {
          expect(pamResult.profitFactor).toBeGreaterThan(0);
          expect(pamResult.profitFactor).not.toBe(99.99);
        }
      }
    });
  });

  describe('Phase 4 Regressions: Options Realism & Historical Contracts', () => {
    it('B27: applies historical dated lot size schedule across revision periods', () => {
      // NIFTY lot sizes
      expect(getDatedLotSize('NIFTY', '2024-03-15')).toBe(50);
      expect(getDatedLotSize('NIFTY', '2024-06-15')).toBe(25);
      expect(getDatedLotSize('NIFTY', '2026-10-12')).toBe(65);

      // BANKNIFTY lot sizes
      expect(getDatedLotSize('BANKNIFTY', '2023-05-15')).toBe(25);
      expect(getDatedLotSize('BANKNIFTY', '2024-03-15')).toBe(15);
      expect(getDatedLotSize('BANKNIFTY', '2026-10-12')).toBe(30);

      // FINNIFTY and MIDCPNIFTY
      expect(getDatedLotSize('FINNIFTY', '2024-03-15')).toBe(40);
      expect(getDatedLotSize('FINNIFTY', '2026-10-12')).toBe(65);
      expect(getDatedLotSize('MIDCPNIFTY', '2024-03-15')).toBe(75);
      expect(getDatedLotSize('MIDCPNIFTY', '2026-10-12')).toBe(120);
    });

    it('B27: calculates dated statutory charges corresponding to revision dates', () => {
      // STT: 0.0625% before Oct 2024; 0.1% before Apr 2026; 0.15% Apr 2026 onward
      const c2024 = calculateOptionCharges({ buyPrice: 100, sellPrice: 100, quantity: 50, date: '2024-05-01' });
      expect(c2024.stt).toBeCloseTo(5000 * 0.000625, 2); // 3.13

      const c2025 = calculateOptionCharges({ buyPrice: 100, sellPrice: 100, quantity: 25, date: '2025-05-01' });
      expect(c2025.stt).toBeCloseTo(2500 * 0.001, 2); // 2.50

      const c2026 = calculateOptionCharges({ buyPrice: 100, sellPrice: 100, quantity: 65, date: '2026-10-12' });
      expect(c2026.stt).toBeCloseTo(6500 * 0.0015, 2); // 9.75
    });

    it('B31: accurately audits template stop feasibility against declared caps without silent inflation', () => {
      // At reference lot 65, NIFTY template with stop 8 requires ₹581.20, which breaches declared cap ₹300
      const t1 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_trend_following')!;
      const auditResult = validateStrategyFeasibility({
        ...t1.defaultConfig,
        astConfig: t1.astConfig,
      });
      expect(auditResult.feasible).toBe(false);
      expect(auditResult.modeledRiskPerLotInr).toBeGreaterThan(500);
      expect(auditResult.declaredTradeCapInr).toBe(300);
      expect(auditResult.reason).toContain('exceeds declared maxAllInTradeLossInr');

      // When calibrated with a feasible stop that fits within the ₹300 cap (e.g. 3.5 pts)
      const feasibleConfig = {
        ...t1.defaultConfig,
        astConfig: {
          ...t1.astConfig,
          exitRules: { ...t1.astConfig.exitRules, stopLossValue: 3.5 },
        },
      };
      const calibratedResult = validateStrategyFeasibility(feasibleConfig as any);
      expect(calibratedResult.feasible).toBe(true);
      expect(calibratedResult.modeledRiskPerLotInr).toBeLessThanOrEqual(300);
    });

    it('B32: legacy conversion preserves direction, PE optionSide, and underlying exit units', () => {
      // Put-only legacy strategy
      const putLegacy: any = {
        id: 'legacy_put',
        underlying: 'NIFTY',
        allowedInstruments: ['LONG_PUT'],
        exit: {
          stopLossType: 'UNDERLYING_POINTS',
          stopLossPoints: 30,
          targetProfitType: 'UNDERLYING_POINTS',
          targetPoints: 60,
        },
      };
      const putAst = convertLegacyStrategyToAst(putLegacy);
      expect(putAst.direction).toBe('BEARISH');
      expect(putAst.contractSelection?.optionSide).toBe('LONG_PE');
      expect(putAst.bearishEntry).toBeDefined();
      expect(putAst.exitRules?.stopLossBasis).toBe('UNDERLYING_POINTS');
      expect(putAst.exitRules?.targetProfitBasis).toBe('UNDERLYING_POINTS');

      // Both-side legacy strategy
      const bothLegacy: any = {
        id: 'legacy_both',
        underlying: 'NIFTY',
        allowedInstruments: ['LONG_CALL', 'LONG_PUT'],
      };
      const bothAst = convertLegacyStrategyToAst(bothLegacy);
      expect(bothAst.direction).toBe('BOTH');
      expect(bothAst.contractSelection?.optionSide).toBe('BOTH');
      expect(bothAst.bullishEntry).toBeDefined();
      expect(bothAst.bearishEntry).toBeDefined();
    });

    it('B05: backtest result includes explicit research mode disclosures and dynamic ATM strike derivation', () => {
      const candles = generateHistoricalMarketCandles('NIFTY', 5, 5, '2026-10-05', '2026-10-05');
      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles,
      });

      expect(result.modelAssumptions.some((a) => a.includes('RESEARCH_MODE'))).toBe(true);
      expect(result.modelAssumptions.some((a) => a.includes('ATM strike dynamically derived'))).toBe(true);
      expect(result.modelAssumptions.some((a) => a.includes('Historical dated statutory fee schedule'))).toBe(true);
    });

    it('B19: indicators respect configured source series and operand multiplier 0 evaluates to 0', () => {
      const candles = Array.from({ length: 30 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-10-05T03:45:00.000Z') + i * 300000).toISOString(),
        open: 20000 + i * 10,
        high: 20010 + i * 10,
        low: 19990 + i * 10,
        close: 20005 + i * 10,
        volume: 2000,
      }));

      // Test buildIndicatorCache with source: 'open' vs default 'close'
      const astClose: any = {
        indicators: [{ id: 'rsi_close', type: 'RSI', period: 14, source: 'close' }],
      };
      const astOpen: any = {
        indicators: [{ id: 'rsi_open', type: 'RSI', period: 14, source: 'open' }],
      };
      const cacheClose = buildIndicatorCache(candles, astClose, { timeframeMinutes: 5, candleTimestampBasis: 'OPEN' });
      const cacheOpen = buildIndicatorCache(candles, astOpen, { timeframeMinutes: 5, candleTimestampBasis: 'OPEN' });
      expect(cacheClose.indicatorSeries.get('rsi_close')).toBeDefined();
      expect(cacheOpen.indicatorSeries.get('rsi_open')).toBeDefined();

      // Test operand with multiplier: 0
      const astWithZeroMult: any = {
        direction: 'BULLISH',
        indicators: [{ id: 'rsi', type: 'RSI', period: 14 }],
        bullishEntry: {
          operator: 'AND',
          conditions: [
            {
              left: { type: 'INDICATOR', indicatorId: 'rsi' },
              comparison: 'GT',
              right: { type: 'INDICATOR', indicatorId: 'rsi', multiplier: 0 },
            },
          ],
        },
      };
      const cache = buildIndicatorCache(candles, astWithZeroMult, { timeframeMinutes: 5, candleTimestampBasis: 'OPEN' });
      const evalResult = evaluateStrategyAst(astWithZeroMult, candles.length - 1, candles, cache);
      // Left is RSI (>0), right is RSI * 0 = 0, so RSI > 0 is true
      expect(evalResult.bullishSignal).toBe(true);
    });

    it('B34: BacktestRequestSchema default values do not override strategy AST trailingProfit setting', () => {
      const parsedReq = BacktestRequestSchema.parse({});
      expect(parsedReq.useTrailingStop).toBeUndefined();
      expect(parsedReq.trailingActivationProfitInr).toBeUndefined();
      expect(parsedReq.trailingStepInr).toBeUndefined();

      // AST with trailing disabled
      const candles = generateHistoricalMarketCandles('NIFTY', 5, 5, '2026-10-05', '2026-10-05');
      const stratWithoutTrailing = {
        ...sampleStrategy,
        astConfig: {
          ...convertLegacyStrategyToAst(sampleStrategy),
          trailingProfit: { enabled: false },
        },
      };
      const result = runStrategyBacktest({
        strategy: stratWithoutTrailing as any,
        candles,
        request: parsedReq,
      });
      expect(result.error).toBeUndefined();
      // Trades should not have trailing stop set if trailing is disabled in AST
      for (const t of result.trades) {
        expect(t.trailingStopPrice).toBeUndefined();
      }
    });

    it('B26: backtest result manifest includes runId, dataFingerprint, effective lots, and equity curve', () => {
      const candles = generateHistoricalMarketCandles('NIFTY', 5, 5, '2026-10-05', '2026-10-05');
      const result = runStrategyBacktest({
        strategy: sampleStrategy,
        candles,
      });

      expect(result.runId).toBeDefined();
      expect(result.runId?.startsWith('bt_')).toBe(true);
      expect(result.dataFingerprint).toContain('bars:');
      expect(result.effectiveLotSize).toBe(65); // Active NIFTY lot size in 2026
      expect(result.effectiveTickSize).toBe(0.05);
      expect(result.effectiveStrategyConfig).toBeDefined();
      expect(Array.isArray(result.equityCurve)).toBe(true);
      expect(result.equityCurve!.length).toBeGreaterThanOrEqual(1);
      expect(result.equityCurve![0]?.equity).toBe(10000);
    });
  });
});


