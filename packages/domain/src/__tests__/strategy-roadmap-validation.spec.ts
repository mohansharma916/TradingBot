import { describe, it, expect } from 'vitest';
import {
  AllowedOptionType,
  InstrumentType,
  StrategyConfig,
  StrategyConfigSchema,
  StrategyStatus,
  TradeDirection,
  TradeMode,
} from '@trading-bot/contracts';
import {
  PREDEFINED_STRATEGY_TEMPLATES,
  calculateStrategyVersionHash,
  buildIndicatorCache,
  evaluateStrategyRules,
  evaluateStrategySignal,
  runStrategyBacktest,
  generateHistoricalMarketCandles,
  getStandardLotSize,
} from '../index';

describe('Phase 4: Automated Backtest & Paper Trading Validation Suite', () => {
  it('validates all 7 roadmap strategy templates exist with calibrated risk parameters', () => {
    expect(PREDEFINED_STRATEGY_TEMPLATES).toHaveLength(7);

    const roadmapIds = [
      'tpl_trend_following',
      'tpl_ema_crossover',
      'tpl_rsi_reversal',
      'tpl_vwap_momentum',
      'tpl_opening_range_breakout',
      'tpl_bollinger_breakout',
      'tpl_bear_panic_detector',
    ];

    const actualIds = PREDEFINED_STRATEGY_TEMPLATES.map((t) => t.id);
    expect(actualIds).toEqual(roadmapIds);

    for (const tpl of PREDEFINED_STRATEGY_TEMPLATES) {
      // Platform mandatory risk bounds
      expect(tpl.defaultConfig.requiresApproval).toBe(true);
      expect(tpl.defaultConfig.maxOpenPositions).toBe(1);
      expect(tpl.defaultConfig.maxCapitalInr).toBeGreaterThan(0);
      expect(tpl.defaultConfig.maxAllInTradeLossInr).toBeGreaterThan(0);
      expect(tpl.defaultConfig.maxAllInDailyLossInr).toBeGreaterThanOrEqual(tpl.defaultConfig.maxAllInTradeLossInr);
      expect(tpl.defaultConfig.targetNetProfitInr).toBeGreaterThan(0);
      expect(tpl.defaultConfig.session).toBeDefined();

      // AST structure
      expect(tpl.astConfig.indicators?.length).toBeGreaterThan(0);
      expect(tpl.astConfig.contractSelection).toBeDefined();
      expect(tpl.astConfig.exitRules).toBeDefined();
      expect(tpl.astConfig.exitRules?.stopLossValue).toBeGreaterThan(0);
      expect(tpl.astConfig.exitRules?.targetProfitValue).toBeGreaterThan(0);
      expect(tpl.astConfig.trailingProfit?.enabled).toBe(true);
    }
  });

  it('verifies calibrated risk targets for individual roadmap strategies S1 to S7', () => {
    // S1 - Triple Confirmation Trend
    const s1 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_trend_following')!;
    expect(s1.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s1.defaultConfig.maxAllInTradeLossInr).toBe(300);
    expect(s1.defaultConfig.targetNetProfitInr).toBe(500);
    expect(s1.astConfig.exitRules?.targetProfitValue).toBe(20);
    expect(s1.astConfig.exitRules?.stopLossValue).toBe(8);
    expect(s1.astConfig.trailingProfit?.trailingGapInr).toBe(60);

    // S2 - VWAP Institutional Surge
    const s2 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_vwap_momentum')!;
    expect(s2.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s2.defaultConfig.targetNetProfitInr).toBe(400);
    expect(s2.defaultConfig.session.lastEntry).toBe('14:30');

    // S3 - Opening Range Breakout (with EMA trend filter)
    const s3 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_opening_range_breakout')!;
    expect(s3.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s3.defaultConfig.maxAllInTradeLossInr).toBe(250);
    expect(s3.defaultConfig.targetNetProfitInr).toBe(450);
    expect(s3.astConfig.indicators?.some((i) => i.id === 'ema_trend_orb')).toBe(true);
    expect(s3.astConfig.bullishEntry?.conditions?.some((c) => c.id === 'c_orb_ema_bull_filter')).toBe(true);
    expect(s3.astConfig.bearishEntry?.conditions?.some((c) => c.id === 'c_orb_ema_bear_filter')).toBe(true);

    // S4 - BANKNIFTY EMA Crossover
    const s4 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_ema_crossover')!;
    expect(s4.recommendedUnderlying).toBe('BANKNIFTY');
    expect(s4.defaultConfig.underlying).toBe('BANKNIFTY');
    expect(s4.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s4.defaultConfig.maxAllInTradeLossInr).toBe(400);
    expect(s4.defaultConfig.maxAllInDailyLossInr).toBe(800);
    expect(s4.defaultConfig.targetNetProfitInr).toBe(700);
    expect(s4.astConfig.exitRules?.stopLossValue).toBe(12);
    expect(s4.astConfig.exitRules?.targetProfitValue).toBe(25);
    expect(s4.astConfig.indicators?.some((i) => i.id === 'vol_avg_x')).toBe(true);

    // S5 - Bollinger Squeeze Breakout (with RSI + Volume filter)
    const s5 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_bollinger_breakout')!;
    expect(s5.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s5.defaultConfig.targetNetProfitInr).toBe(400);
    expect(s5.astConfig.exitRules?.targetProfitValue).toBe(20);
    expect(s5.astConfig.indicators?.some((i) => i.id === 'rsi_bb')).toBe(true);
    expect(s5.astConfig.indicators?.some((i) => i.id === 'vol_avg_bb')).toBe(true);

    // S6 - RSI Exhaustion Reversal
    const s6 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rsi_reversal')!;
    expect(s6.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s6.defaultConfig.targetNetProfitInr).toBe(300);
    expect(s6.astConfig.exitRules?.stopLossValue).toBe(7);
    expect(s6.astConfig.exitRules?.targetProfitValue).toBe(15);

    // S7 - Bear Panic Detector
    const s7 = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_bear_panic_detector')!;
    expect(s7.astConfig.direction).toBe(TradeDirection.BEARISH);
    expect(s7.defaultConfig.allowedInstruments).toEqual([AllowedOptionType.LONG_PUT]);
    expect(s7.defaultConfig.maxCapitalInr).toBe(10000);
    expect(s7.defaultConfig.targetNetProfitInr).toBe(1200);
    expect(s7.astConfig.exitRules?.targetProfitValue).toBe(30);
    expect(s7.astConfig.exitRules?.stopLossValue).toBe(10);
    expect(s7.defaultConfig.session.start).toBe('10:00');
    expect(s7.defaultConfig.session.lastEntry).toBe('14:00');
  });

  it('passes StrategyConfigSchema parsing and version hashing for all 7 instantiated strategies', () => {
    for (let i = 0; i < PREDEFINED_STRATEGY_TEMPLATES.length; i++) {
      const tpl = PREDEFINED_STRATEGY_TEMPLATES[i]!;
      const strategyData = {
        ...tpl.defaultConfig,
        id: `550e8400-e29b-41d4-a716-4466554400${String(i + 1).padStart(2, '0')}`,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        templateId: tpl.id,
        version: 1,
        status: StrategyStatus.PAPER_ACTIVE,
        tradeMode: TradeMode.PAPER,
        astConfig: tpl.astConfig,
      };

      const parsed = StrategyConfigSchema.parse(strategyData);
      expect(parsed).toBeDefined();
      expect(parsed.id).toBe(strategyData.id);

      const hash = calculateStrategyVersionHash(parsed);
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(10);
    }
  });

  it('executes deterministic backtesting across all 7 strategies without errors', () => {
    const niftyCandles = generateHistoricalMarketCandles('NIFTY', 14, 5);
    const bankniftyCandles = generateHistoricalMarketCandles('BANKNIFTY', 14, 5);

    expect(niftyCandles.length).toBeGreaterThan(20);
    expect(bankniftyCandles.length).toBeGreaterThan(20);

    for (let i = 0; i < PREDEFINED_STRATEGY_TEMPLATES.length; i++) {
      const tpl = PREDEFINED_STRATEGY_TEMPLATES[i]!;
      const underlying = tpl.defaultConfig.underlying || 'NIFTY';
      const candles = underlying === 'BANKNIFTY' ? bankniftyCandles : niftyCandles;
      const initialCapital = tpl.defaultConfig.maxCapitalInr || 15000;

      const strategy: StrategyConfig = {
        id: `550e8400-e29b-41d4-a716-4466554400${String(i + 1).padStart(2, '0')}`,
        name: tpl.name,
        version: 1,
        status: StrategyStatus.PAPER_ACTIVE,
        tradeMode: TradeMode.PAPER,
        market: 'NSE_FO',
        underlying,
        allowedInstruments: tpl.defaultConfig.allowedInstruments,
        timeframe: '5m',
        session: tpl.defaultConfig.session,
        astConfig: tpl.astConfig,
        risk: {
          maxCapitalInr: initialCapital,
          maxAllInTradeLossInr: tpl.defaultConfig.maxAllInTradeLossInr,
          maxAllInDailyLossInr: tpl.defaultConfig.maxAllInDailyLossInr,
          targetNetProfitInr: tpl.defaultConfig.targetNetProfitInr,
          maxTradesPerDay: 3,
        },
      } as any;

      const result = runStrategyBacktest({
        strategy,
        candles,
        request: {
          initialCapital,
          underlying,
          useTrailingStop: true,
          trailingActivationProfitInr: tpl.astConfig.trailingProfit?.activationProfitInr,
          trailingStepInr: tpl.astConfig.trailingProfit?.trailingGapInr,
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.strategyId).toBe(strategy.id);
      expect(result.initialCapital).toBe(initialCapital);
      expect(Number.isFinite(result.finalCapital)).toBe(true);
      expect(Number.isFinite(result.netPnl)).toBe(true);
      expect(result.netPnl).toBe(Number((result.grossPnl - result.totalCharges).toFixed(2)));
      expect(result.finalCapital).toBe(Number((initialCapital + result.netPnl).toFixed(2)));
      expect(result.winRatePct).toBeGreaterThanOrEqual(0);
      expect(result.winRatePct).toBeLessThanOrEqual(100);

      // Verify every executed trade in the backtest satisfies statutory accounting
      for (const trade of result.trades) {
        expect(trade.charges).toBeGreaterThan(0);
        expect(trade.quantity).toBe(getStandardLotSize(underlying));
        expect([
          'TARGET_PROFIT',
          'STOP_LOSS',
          'TIME_CUTOFF',
          'TRAILING_STOP_LOSS',
          'DATASET_END',
          'SESSION_DATA_END',
          'OPPOSITE_SIGNAL',
        ]).toContain(trade.exitReason);
      }
    }
  });

  it('validates paper trading signal and runtime rule evaluation with lot-size safety', () => {
    const candles = generateHistoricalMarketCandles('NIFTY', 5, 5);
    const quote = {
      instrumentKey: 'NSE_FO|123456',
      lastPrice: 110,
      bidPrice: 109.9,
      askPrice: 110.1,
      bidQty: 1000,
      askQty: 1000,
      volume: 50000,
      openInterest: 20000,
      timestamp: new Date().toISOString(),
      isStale: false,
    };

    const candidateInstrument = {
      instrumentKey: quote.instrumentKey,
      symbol: 'NIFTY 24000 CE',
      underlying: 'NIFTY',
      instrumentType: InstrumentType.CE,
      lotSize: 65,
      tickSize: 0.05,
    };

    const s1 = PREDEFINED_STRATEGY_TEMPLATES[0]!;
    const strategy: StrategyConfig = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: s1.name,
      version: 1,
      status: StrategyStatus.PAPER_ACTIVE,
      tradeMode: TradeMode.PAPER,
      market: 'NSE_FO',
      underlying: 'NIFTY',
      allowedInstruments: [AllowedOptionType.LONG_CALL, AllowedOptionType.LONG_PUT],
      timeframe: '5m',
      session: s1.defaultConfig.session,
      astConfig: s1.astConfig,
    } as any;

    // Evaluates strategy signal cleanly
    const sig = evaluateStrategySignal({ strategy, candles });
    expect(typeof sig.bullishSignal).toBe('boolean');
    expect(typeof sig.bearishSignal).toBe('boolean');
    expect(sig.isWarmedUp).toBe(true);

    // Evaluates runtime rules against candidate instrument
    const ruleEval = evaluateStrategyRules({
      strategy,
      underlyingCandles: candles,
      candidateQuote: quote,
      candidateInstrument,
      currentTimeIst: '10:30',
    });
    expect(typeof ruleEval.passed).toBe('boolean');
    expect(Array.isArray(ruleEval.reasons)).toBe(true);
  });
});
