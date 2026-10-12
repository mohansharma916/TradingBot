import { describe, it, expect } from 'vitest';
import {
  buildIndicatorCache,
  evaluateConditionRule,
  resolveOperandValue,
  convertLegacyStrategyToAst,
} from '../strategy-rule-evaluator';
import { calculateRSI, calculateVWAP } from '../indicators';
import { runStrategyBacktest } from '../backtest-engine';
import { evaluateStrategyRules, evaluateStrategySignal } from '../strategy-evaluator';
import { StrategyAstConfigSchema } from '@trading-bot/contracts';
import { PREDEFINED_STRATEGY_TEMPLATES, validateStrategyFeasibility } from '../strategy-templates';

const bars = (n = 5, volume = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.parse('2026-10-12T03:45:00Z') + i * 300000).toISOString(),
    open: 10000,
    high: 10000,
    low: 10000,
    close: 10000,
    volume,
  }));

const cond = (left: any, right: any, comparison: any = 'GT') => ({ id: 'condition', left, comparison, right });
const group = (condition: any, operator: any = 'AND') => ({ id: 'entry', operator, conditions: [condition] });
const basicAst = (condition = cond({ type: 'NUMBER', value: 1 }, { type: 'NUMBER', value: 0 })) =>
  ({
    direction: 'BULLISH',
    indicators: [],
    bullishEntry: group(condition),
    entryRules: { allowReentry: true, cooldownBars: 0 },
    contractSelection: { optionSide: 'LONG_CE', minVolume: 0, minOpenInterest: 0, maxBidAskSpreadPct: 1.5 },
    exitRules: { stopLossBasis: 'OPTION_PREMIUM', stopLossValue: 2, targetProfitBasis: 'OPTION_PREMIUM', targetProfitValue: 4, marketCutoffTime: '15:10' },
    trailingProfit: { enabled: false },
  } as any);

const strategy = () =>
  ({
    id: 'audit_fixture',
    name: 'Audit fixture',
    version: 1,
    underlying: 'NIFTY',
    timeframe: '5m',
    allowedInstruments: ['LONG_CALL'],
    session: { start: '09:15', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
    risk: {
      maxCapitalInr: 4000,
      maxAllInTradeLossInr: 500,
      maxAllInDailyLossInr: 1500,
      maxOpenPositions: 1,
      maxTradesPerDay: 10,
      targetNetProfitInr: 300,
      maxRoundTripCostBudgetInr: 200,
    },
    astConfig: basicAst(),
  } as any);

describe('Strategy Rule Evaluator & Template Feasibility Regression Tests', () => {
  it('volume conditions do not pass when volume is zero and do not invent volume', () => {
    const prefix = bars(3, 0);
    const volumeRule = cond({ type: 'CANDLE_FIELD', field: 'volume' }, { type: 'NUMBER', value: 1000000 });
    const va = basicAst(volumeRule);
    const pc = buildIndicatorCache(prefix, va);

    const pass = evaluateConditionRule(volumeRule, 2, prefix, pc);
    expect(pass).toBe(false);
  });

  it('VWAP on zero-volume dataset returns null/NaN without inventing artificial values', () => {
    const prefix = bars(3, 0);
    const wa = basicAst();
    wa.indicators = [{ id: 'vwap', type: 'VWAP' }];
    const wp = buildIndicatorCache(prefix, wa);
    const cached = wp.indicatorSeries.get('vwap')![2];
    expect(cached === null || isNaN(cached!)).toBe(true);
  });

  it('evaluates operand multiplier of 0 to exactly 0', () => {
    const prefix = bars(3, 100);
    const pc = buildIndicatorCache(prefix, basicAst());
    const val = resolveOperandValue({ type: 'NUMBER', value: 10, multiplier: 0 }, 2, prefix, pc);
    expect(val).toBe(0);
  });

  it('calculates RSI over configured open source rather than hardcoding close', () => {
    const opened = bars(20).map((c, i) => ({
      ...c,
      open: 120 - i,
      high: Math.max(120 - i, 100 + i) + 1,
      low: Math.min(120 - i, 100 + i) - 1,
      close: 100 + i,
    }));
    const ra = basicAst();
    ra.indicators = [{ id: 'rsi_open', type: 'RSI', period: 14, source: 'open' }];
    const cache = buildIndicatorCache(opened, ra);
    const expected = calculateRSI(opened.map((c) => c.open), 14).at(-1);
    const actual = cache.indicatorSeries.get('rsi_open')!.at(-1);
    expect(actual).toBeCloseTo(expected!, 4);
  });

  it('enforces coarse candle cutoff boundary at TIME_CUTOFF instead of claiming post-cutoff profit', () => {
    const coarse = strategy();
    coarse.timeframe = '15m';
    coarse.astConfig.exitRules.marketCutoffTime = '14:50';
    const coarseBars = bars(5).map((c, i) => ({
      ...c,
      timestamp: new Date(Date.parse('2026-10-12T08:15:00Z') + i * 900000).toISOString(),
      ...(i === 4 ? { high: 10010 } : {}),
    }));
    const co = runStrategyBacktest({
      strategy: coarse,
      candles: coarseBars,
      request: { initialCapital: 10000, useTrailingStop: false },
      dataSource: 'COARSE_CUTOFF_FIXTURE',
    });
    expect(co.trades).toHaveLength(1);
    expect(co.trades[0]!.exitReason).toBe('TIME_CUTOFF');
  });

  it('preserves legacy conversion semantics for put-only strategies', () => {
    const legacy: any = strategy();
    delete legacy.astConfig;
    legacy.allowedInstruments = ['LONG_PUT'];
    legacy.exit = { stopBasis: 'UNDERLYING_LEVEL', stopLossPoints: 2, targetPoints: 4, marketCutoff: '15:10' };

    const converted = convertLegacyStrategyToAst(legacy);
    expect(converted.direction).toBe('BEARISH');
    expect(converted.contractSelection?.optionSide).toBe('LONG_PE');
    expect(converted.exitRules?.stopLossBasis).toBe('UNDERLYING_POINTS');
  });

  it('validates template feasibility against active exchange lot size and fees', () => {
    for (const tpl of PREDEFINED_STRATEGY_TEMPLATES) {
      const feasibility = validateStrategyFeasibility({
        underlying: tpl.defaultConfig.underlying,
        astConfig: tpl.astConfig,
        risk: tpl.defaultConfig as any,
      });
      expect(feasibility).toBeDefined();
      expect(feasibility.lotSize).toBeGreaterThan(0);
      expect(feasibility.modeledRiskPerLotInr).toBeGreaterThan(0);
    }
  });
});
