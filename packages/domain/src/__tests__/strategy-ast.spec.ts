import { describe, it, expect } from 'vitest';
import {
  AllowedOptionType,
  ComparisonOperator,
  IndicatorType,
  LogicalOperator,
  StrategyAstConfig,
  TradeDirection,
} from '@trading-bot/contracts';
import {
  buildIndicatorCache,
  evaluateStrategyAst,
  evaluateConditionRule,
  evaluateRuleGroup,
  convertLegacyStrategyToAst,
} from '../strategy-rule-evaluator';
import { PREDEFINED_STRATEGY_TEMPLATES } from '../strategy-templates';
import { runStrategyBacktest } from '../backtest-engine';
import { Candle } from '../indicators';

function makeMockCandles(count: number, basePrice = 24000, trend = 5): Candle[] {
  const candles: Candle[] = [];
  const startTime = new Date('2026-03-02T09:15:00+05:30').getTime();

  for (let i = 0; i < count; i++) {
    const close = basePrice + i * trend + (i % 2 === 0 ? 3 : -3);
    candles.push({
      timestamp: new Date(startTime + i * 300000).toISOString(),
      open: close - 2,
      high: close + 8,
      low: close - 6,
      close,
      volume: 1500 + i * 50,
    });
  }
  return candles;
}

describe('Strategy Lab: AST Evaluator & Templates', () => {
  it('defines 7 research templates with valid AST configs', () => {
    expect(PREDEFINED_STRATEGY_TEMPLATES).toHaveLength(7);

    const ids = PREDEFINED_STRATEGY_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('tpl_trend_following');
    expect(ids).toContain('tpl_ema_crossover');
    expect(ids).toContain('tpl_rsi_reversal');
    expect(ids).toContain('tpl_vwap_momentum');
    expect(ids).toContain('tpl_opening_range_breakout');
    expect(ids).toContain('tpl_bollinger_breakout');
    expect(ids).toContain('tpl_bear_panic_detector');

    for (const tpl of PREDEFINED_STRATEGY_TEMPLATES) {
      expect(tpl.name).toBeTruthy();
      expect(tpl.astConfig.indicators?.length).toBeGreaterThan(0);
      expect(tpl.astConfig.bullishEntry).toBeDefined();
      expect(tpl.astConfig.bearishEntry).toBeDefined();
      expect(tpl.astConfig.contractSelection).toBeDefined();
      expect(tpl.astConfig.exitRules).toBeDefined();
    }
  });

  it('builds indicator cache and evaluates bullish/bearish conditions', () => {
    const candles = makeMockCandles(50, 24000, 10);
    const ast: StrategyAstConfig = {
      category: 'TEST',
      direction: TradeDirection.BOTH,
      indicators: [
        { id: 'ema_20', type: IndicatorType.EMA, period: 20 },
        { id: 'ema_50', type: IndicatorType.EMA, period: 30 },
      ],
      bullishEntry: {
        id: 'g_bull',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            left: { type: 'INDICATOR', indicatorId: 'ema_20' },
            comparison: ComparisonOperator.GT,
            right: { type: 'INDICATOR', indicatorId: 'ema_50' },
          },
        ],
      },
    };

    const cache = buildIndicatorCache(candles, ast);
    expect(cache.indicatorSeries.has('ema_20')).toBe(true);
    expect(cache.indicatorSeries.has('ema_50')).toBe(true);

    const res = evaluateStrategyAst(ast, 45, candles, cache);
    expect(res.isWarmedUp).toBe(true);
    expect(res.bullishSignal).toBe(true);
  });

  it('correctly detects CROSSES_ABOVE and CROSSES_BELOW transitions', () => {
    // Create candles where Fast EMA crosses Slow EMA
    const candles = makeMockCandles(40, 24000, 1);
    const cache = {
      indicatorSeries: new Map([
        ['fast', [10, 15, 20, 25]],
        ['slow', [12, 16, 18, 20]],
      ]),
      multiFieldSeries: new Map(),
      warmupRequired: 2,
    };

    // At bar 1: fast(15) <= slow(16). At bar 2: fast(20) > slow(18) -> Crosses Above
    const crossAboveRule = {
      id: 'r_cross_up',
      left: { type: 'INDICATOR' as const, indicatorId: 'fast' },
      comparison: ComparisonOperator.CROSSES_ABOVE,
      right: { type: 'INDICATOR' as const, indicatorId: 'slow' },
    };

    const passedCross = evaluateConditionRule(crossAboveRule, 2, candles, cache);
    expect(passedCross).toBe(true);

    // At bar 3: fast(25) > slow(20), but bar 2 fast(20) > slow(18), so NOT crossing at bar 3
    const notCrossAtBar3 = evaluateConditionRule(crossAboveRule, 3, candles, cache);
    expect(notCrossAtBar3).toBe(false);
  });

  it('handles nested logical groups: (Cond1 AND Cond2) OR Cond3', () => {
    const candles = makeMockCandles(30);
    const cache = {
      indicatorSeries: new Map([
        ['a', [10, 20, 30]],
        ['b', [5, 15, 25]],
      ]),
      multiFieldSeries: new Map(),
      warmupRequired: 1,
    };

    const nestedGroup = {
      id: 'g_main',
      operator: LogicalOperator.OR,
      conditions: [
        {
          id: 'g_sub_and',
          operator: LogicalOperator.AND,
          conditions: [
            {
              id: 'c_fail',
              left: { type: 'NUMBER' as const, value: 5 },
              comparison: ComparisonOperator.GT,
              right: { type: 'NUMBER' as const, value: 10 },
            },
          ],
        },
        {
          id: 'c_pass',
          left: { type: 'NUMBER' as const, value: 100 },
          comparison: ComparisonOperator.GT,
          right: { type: 'NUMBER' as const, value: 50 },
        },
      ],
    };

    const res = evaluateRuleGroup(nestedGroup, 2, candles, cache);
    expect(res).toBe(true);
  });

  it('fails closed when indicators have insufficient warm-up or missing values', () => {
    const candles = makeMockCandles(10);
    const ast: StrategyAstConfig = {
      indicators: [{ id: 'ema_slow', type: IndicatorType.EMA, period: 30 }],
      bullishEntry: {
        id: 'g1',
        operator: LogicalOperator.AND,
        conditions: [
          {
            id: 'c1',
            left: { type: 'INDICATOR', indicatorId: 'ema_slow' },
            comparison: ComparisonOperator.GT,
            right: { type: 'NUMBER', value: 100 },
          },
        ],
      },
    };

    const cache = buildIndicatorCache(candles, ast);
    const res = evaluateStrategyAst(ast, 5, candles, cache);
    expect(res.bullishSignal).toBe(false);
    expect(res.isWarmedUp).toBe(false);
  });

  it('runs an explicitly modeled backtest with affordable template exits', () => {
    const tpl = PREDEFINED_STRATEGY_TEMPLATES[0]!;
    const candles = makeMockCandles(80, 24200, 8);

    const result = runStrategyBacktest({
      strategy: {
        id: '550e8400-e29b-41d4-a716-446655440099',
        name: tpl.name,
        version: 1,
        underlying: 'NIFTY',
        timeframe: '5m',
        astConfig: { ...tpl.astConfig, exitRules: { ...tpl.astConfig.exitRules, stopLossValue: 2 } },
        session: { start: '09:15', lastEntry: '15:00', timezone: 'Asia/Kolkata' },
      } as any,
      candles,
      request: {
        initialCapital: 25000,
        useTrailingStop: true,
        trailingActivationProfitInr: 100,
        trailingStepInr: 30,
      },
    });

    expect(result.strategyName).toBe(tpl.name);
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.finalCapital).toBeGreaterThan(0);
    expect(result.totalCharges).toBeGreaterThanOrEqual(0);
    expect(result.winRatePct).toBeGreaterThanOrEqual(0);
  });

  it('evaluates Bear Panic Detector (S7) AST structure and directional constraints', () => {
    const tpl = PREDEFINED_STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_bear_panic_detector')!;
    expect(tpl).toBeDefined();
    expect(tpl.astConfig.direction).toBe(TradeDirection.BEARISH);
    expect(tpl.astConfig.indicators).toHaveLength(6);
    expect(tpl.astConfig.contractSelection.optionSide).toBe('LONG_PE');
    expect(tpl.defaultConfig.allowedInstruments).toEqual([AllowedOptionType.LONG_PUT]);
    expect(tpl.astConfig.exitRules.targetProfitValue).toBe(30);
    expect(tpl.astConfig.exitRules.stopLossValue).toBe(10);
    expect(tpl.defaultConfig.maxCapitalInr).toBe(10000);
    expect(tpl.defaultConfig.targetNetProfitInr).toBe(1200);

    const candles = makeMockCandles(60, 24000, -10);
    const cache = buildIndicatorCache(candles, tpl.astConfig);
    expect(cache.indicatorSeries.has('ema_fast_panic')).toBe(true);
    expect(cache.indicatorSeries.has('ema_slow_panic')).toBe(true);
    expect(cache.indicatorSeries.has('vwap_panic')).toBe(true);
    expect(cache.indicatorSeries.has('rsi_panic')).toBe(true);
    expect(cache.indicatorSeries.has('atr_panic')).toBe(true);
    expect(cache.indicatorSeries.has('vol_avg_panic')).toBe(true);

    const res = evaluateStrategyAst(tpl.astConfig, 55, candles, cache);
    expect(res.bullishSignal).toBe(false);
  });
});
