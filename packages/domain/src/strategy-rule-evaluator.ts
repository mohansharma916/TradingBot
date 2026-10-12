import {
  ComparisonOperator,
  ConditionRule,
  IndicatorType,
  LogicalOperator,
  RuleGroup,
  RuleOperand,
  StrategyAstConfig,
  StrategyConfig,
  StrikeSelection,
  TradeDirection,
} from '@trading-bot/contracts';
import {
  Candle,
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateHighestHigh,
  calculateLowestLow,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateVWAP,
} from './indicators';

export interface EvaluatorCache {
  indicatorSeries: Map<string, number[]>;
  multiFieldSeries: Map<string, Record<string, number[]>>;
  warmupRequired: number;
}

/**
 * Precomputes and caches all indicator series across the entire candle history
 * for fast deterministic lookups during bar-by-bar backtesting or live scanning.
 */
export function buildIndicatorCache(
  candles: Candle[],
  astConfig: StrategyAstConfig,
  options: { timeframeMinutes?: number; candleTimestampBasis?: 'OPEN' | 'CLOSE' } = {},
): EvaluatorCache {
  const cache: EvaluatorCache = {
    indicatorSeries: new Map(),
    multiFieldSeries: new Map(),
    warmupRequired: 20,
  };

  const volumes = candles.map((c) => c.volume);

  let maxWarmup = 2;

  for (const ind of astConfig.indicators || []) {
    const id = ind.id;
    const period = ind.period ?? 14;

    switch (ind.type) {
      case IndicatorType.EMA: {
        const sourceData = getSourceSeries(candles, ind.source);
        const series = calculateEMA(sourceData, period);
        // Pad series with NaNs at start so index aligns with candle index
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (period > maxWarmup) maxWarmup = period;
        break;
      }

      case IndicatorType.SMA: {
        const sourceData = getSourceSeries(candles, ind.source);
        const series = calculateSMA(sourceData, period);
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (period > maxWarmup) maxWarmup = period;
        break;
      }

      case IndicatorType.RSI: {
        const sourceData = getSourceSeries(candles, ind.source);
        const series = calculateRSI(sourceData, period);
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (period + 1 > maxWarmup) maxWarmup = period + 1;
        break;
      }

      case IndicatorType.VWAP: {
        const hasVolume = candles.some((c) => (c.volume ?? 0) > 0);
        const series = hasVolume
          ? calculateVWAP(candles)
          : new Array(candles.length).fill(NaN);
        cache.indicatorSeries.set(id, series);
        break;
      }

      case IndicatorType.BOLLINGER_BANDS: {
        const mult = ind.stdDevMultiplier ?? 2;
        const sourceData = getSourceSeries(candles, ind.source);
        const bb = calculateBollingerBands(sourceData, period, mult);
        cache.multiFieldSeries.set(id, {
          upper: padSeries(bb.upper, candles.length),
          middle: padSeries(bb.middle, candles.length),
          lower: padSeries(bb.lower, candles.length),
        });
        if (period > maxWarmup) maxWarmup = period;
        break;
      }

      case IndicatorType.MACD: {
        const fast = ind.fastPeriod ?? 12;
        const slow = ind.slowPeriod ?? 26;
        const signal = ind.signalPeriod ?? 9;
        const sourceData = getSourceSeries(candles, ind.source);
        const macd = calculateMACD(sourceData, fast, slow, signal);
        cache.multiFieldSeries.set(id, {
          macd: padSeries(macd.macd, candles.length),
          signal: padSeries(macd.signal, candles.length),
          histogram: padSeries(macd.histogram, candles.length),
        });
        const req = slow + signal;
        if (req > maxWarmup) maxWarmup = req;
        break;
      }

      case IndicatorType.ATR: {
        const series = calculateATR(candles, period);
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (period + 1 > maxWarmup) maxWarmup = period + 1;
        break;
      }

      case IndicatorType.ADX: {
        const adxRes = calculateADX(candles, period);
        cache.multiFieldSeries.set(id, {
          adx: padSeries(adxRes.adx, candles.length),
          plusDI: padSeries(adxRes.plusDI, candles.length),
          minusDI: padSeries(adxRes.minusDI, candles.length),
        });
        const req = period * 2;
        if (req > maxWarmup) maxWarmup = req;
        break;
      }

      case IndicatorType.HIGHEST_HIGH: {
        const lookback = ind.lookback ?? period;
        const series = astConfig.templateId === 'tpl_opening_range_breakout' && id === 'high_3_bars'
          ? openingRangeSeries(candles, 'high', options)
          : calculateHighestHigh(candles, lookback);
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (lookback > maxWarmup) maxWarmup = lookback;
        break;
      }

      case IndicatorType.LOWEST_LOW: {
        const lookback = ind.lookback ?? period;
        const series = astConfig.templateId === 'tpl_opening_range_breakout' && id === 'low_3_bars'
          ? openingRangeSeries(candles, 'low', options)
          : calculateLowestLow(candles, lookback);
        const padded = padSeries(series, candles.length);
        cache.indicatorSeries.set(id, padded);
        if (lookback > maxWarmup) maxWarmup = lookback;
        break;
      }

      case IndicatorType.VOLUME: {
        // Raw volume or SMA of volume
        if (ind.period && ind.period > 1) {
          const smaVol = calculateSMA(volumes, ind.period);
          cache.indicatorSeries.set(id, padSeries(smaVol, candles.length));
          if (ind.period > maxWarmup) maxWarmup = ind.period;
        } else {
          cache.indicatorSeries.set(id, volumes);
        }
        break;
      }

      default:
        break;
    }
  }

  cache.warmupRequired = maxWarmup;
  return cache;
}

/** Freeze the complete 09:15–09:30 IST range; missing opening bars never become a guessed range. */
function openingRangeSeries(candles: Candle[], field: 'high' | 'low', options: { timeframeMinutes?: number; candleTimestampBasis?: 'OPEN' | 'CLOSE' }): number[] {
  const interval = (options.timeframeMinutes ?? 5) * 60000;
  let day = '';
  let collected: Candle[] = [];
  let frozen = NaN;
  return candles.map((candle) => {
    const timestamp = Number(new Date(candle.timestamp));
    const start = timestamp - (options.candleTimestampBasis === 'CLOSE' ? interval : 0);
    const ist = new Date(start + 330 * 60000);
    if (!Number.isFinite(start)) return NaN;
    const currentDay = ist.toISOString().slice(0, 10);
    if (currentDay !== day) { day = currentDay; collected = []; frozen = NaN; }
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (minutes >= 555 && minutes < 570) {
      collected.push(candle);
      const expected = 15 * 60000 / interval;
      if (Number.isInteger(expected) && collected.length === expected && minutes + interval / 60000 === 570) {
        const first = Number(new Date(collected[0]!.timestamp)) - (options.candleTimestampBasis === 'CLOSE' ? interval : 0);
        const firstMinutes = new Date(first + 330 * 60000).getUTCHours() * 60 + new Date(first + 330 * 60000).getUTCMinutes();
        const contiguous = collected.every((bar, index) => Number(new Date(bar.timestamp)) - Number(new Date(collected[0]!.timestamp)) === index * interval);
        if (firstMinutes === 555 && contiguous) frozen = field === 'high' ? Math.max(...collected.map((bar) => bar.high)) : Math.min(...collected.map((bar) => bar.low));
      }
    }
    return frozen;
  });
}

function padSeries(series: number[], targetLength: number): number[] {
  if (series.length >= targetLength) return series;
  const paddingCount = targetLength - series.length;
  const padding = new Array(paddingCount).fill(NaN);
  return padding.concat(series);
}

function getSourceSeries(candles: Candle[], source?: string): number[] {
  switch (source) {
    case 'open':
      return candles.map((c) => c.open);
    case 'high':
      return candles.map((c) => c.high);
    case 'low':
      return candles.map((c) => c.low);
    case 'hl2':
      return candles.map((c) => (c.high + c.low) / 2);
    case 'hlc3':
      return candles.map((c) => (c.high + c.low + c.close) / 3);
    case 'ohlc4':
      return candles.map((c) => (c.open + c.high + c.low + c.close) / 4);
    case 'close':
    default:
      return candles.map((c) => c.close);
  }
}

/**
 * Resolves a RuleOperand to a numeric value at a given candle index.
 */
export function resolveOperandValue(
  operand: RuleOperand | undefined,
  barIndex: number,
  candles: Candle[],
  cache: EvaluatorCache,
): number | null {
  if (!operand) return null;

  if (operand.type === 'NUMBER') {
    const base = operand.value ?? 0;
    return operand.multiplier !== undefined ? base * operand.multiplier : base;
  }

  const offset = operand.offset ?? 0;
  const targetIndex = barIndex - offset;
  if (targetIndex < 0 || targetIndex >= candles.length) {
    return null; // out of range
  }

  let value: number | null = null;

  if (operand.type === 'CANDLE_FIELD') {
    const candle = candles[targetIndex]!;
    const field = operand.field || 'close';
    switch (field.toLowerCase()) {
      case 'open':
        value = candle.open;
        break;
      case 'high':
        value = candle.high;
        break;
      case 'low':
        value = candle.low;
        break;
      case 'close':
        value = candle.close;
        break;
      case 'volume':
        value = candle.volume;
        break;
      case 'prev_high':
        value = targetIndex > 0 ? candles[targetIndex - 1]!.high : null;
        break;
      case 'prev_low':
        value = targetIndex > 0 ? candles[targetIndex - 1]!.low : null;
        break;
      default:
        value = candle.close;
    }
  } else if (operand.type === 'INDICATOR' && operand.indicatorId) {
    // Check multi-field (BB, MACD, ADX)
    const multi = cache.multiFieldSeries.get(operand.indicatorId);
    if (multi && operand.field && multi[operand.field]) {
      value = multi[operand.field]![targetIndex] ?? null;
    } else {
      const single = cache.indicatorSeries.get(operand.indicatorId);
      if (single) {
        value = single[targetIndex] ?? null;
      }
    }
  }

  if (value === null || isNaN(value)) {
    return null;
  }

  return operand.multiplier !== undefined ? value * operand.multiplier : value;
}

/**
 * Evaluates a single ConditionRule against the current bar.
 */
export function evaluateConditionRule(
  rule: ConditionRule,
  barIndex: number,
  candles: Candle[],
  cache: EvaluatorCache,
): boolean | null {
  if (rule.enabled === false) return true; // Disabled condition is considered pass

  // Get current bar values
  const leftCurr = resolveOperandValue(rule.left, barIndex, candles, cache);
  if (leftCurr === null) return null;

  const comp = rule.comparison;

  // Single-operand operators
  if (comp === ComparisonOperator.INCREASING) {
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    if (leftPrev === null) return null;
    return leftCurr > leftPrev;
  }

  if (comp === ComparisonOperator.DECREASING) {
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    if (leftPrev === null) return null;
    return leftCurr < leftPrev;
  }

  if (comp === ComparisonOperator.BETWEEN) {
    if (rule.right?.min !== undefined && rule.right?.max !== undefined) {
      return leftCurr >= rule.right.min && leftCurr <= rule.right.max;
    }
    return null;
  }

  // Crosses Above / Below require barIndex and barIndex - 1
  if (comp === ComparisonOperator.CROSSES_ABOVE) {
    const rightCurr = resolveOperandValue(rule.right, barIndex, candles, cache);
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    const rightPrev = resolveOperandValue(rule.right, barIndex - 1, candles, cache);

    if (rightCurr === null || leftPrev === null || rightPrev === null) return null;
    return leftPrev <= rightPrev && leftCurr > rightCurr;
  }

  if (comp === ComparisonOperator.CROSSES_BELOW) {
    const rightCurr = resolveOperandValue(rule.right, barIndex, candles, cache);
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    const rightPrev = resolveOperandValue(rule.right, barIndex - 1, candles, cache);

    if (rightCurr === null || leftPrev === null || rightPrev === null) return null;
    return leftPrev >= rightPrev && leftCurr < rightCurr;
  }

  if (comp === ComparisonOperator.PCT_CHANGE_ABOVE) {
    const rightVal = resolveOperandValue(rule.right, barIndex, candles, cache);
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    if (rightVal === null || leftPrev === null || leftPrev === 0) return null;
    const pctChange = ((leftCurr - leftPrev) / leftPrev) * 100;
    return pctChange > rightVal;
  }

  if (comp === ComparisonOperator.PCT_CHANGE_BELOW) {
    const rightVal = resolveOperandValue(rule.right, barIndex, candles, cache);
    const leftPrev = resolveOperandValue(rule.left, barIndex - 1, candles, cache);
    if (rightVal === null || leftPrev === null || leftPrev === 0) return null;
    const pctChange = ((leftCurr - leftPrev) / leftPrev) * 100;
    return pctChange < rightVal;
  }

  // Standard binary operators
  const rightCurr = resolveOperandValue(rule.right, barIndex, candles, cache);
  if (rightCurr === null) return null;

  const tolerance = rule.tolerance ?? 1e-4;

  switch (comp) {
    case ComparisonOperator.GT:
      return leftCurr > rightCurr;
    case ComparisonOperator.GTE:
      return leftCurr >= rightCurr - tolerance;
    case ComparisonOperator.LT:
      return leftCurr < rightCurr;
    case ComparisonOperator.LTE:
      return leftCurr <= rightCurr + tolerance;
    case ComparisonOperator.EQ:
      return Math.abs(leftCurr - rightCurr) <= tolerance;
    case ComparisonOperator.NEQ:
      return Math.abs(leftCurr - rightCurr) > tolerance;
    default:
      return null;
  }
}

/**
 * Recursively evaluates a RuleGroup (supports nested AND, OR, NOT).
 */
export function evaluateRuleGroup(
  group: RuleGroup | undefined,
  barIndex: number,
  candles: Candle[],
  cache: EvaluatorCache,
): boolean | null {
  if (!group || group.enabled === false) return null;
  if (!group.conditions || group.conditions.length === 0) return null;

  const op = group.operator || LogicalOperator.AND;
  const activeConditions = group.conditions.filter((c: any) => c.enabled !== false);
  if (activeConditions.length === 0) return null;

  if (op === LogicalOperator.AND) {
    let hasNull = false;
    for (const item of activeConditions) {
      const passes = isRuleGroup(item)
        ? evaluateRuleGroup(item, barIndex, candles, cache)
        : evaluateConditionRule(item, barIndex, candles, cache);
      if (passes === false) return false;
      if (passes === null) hasNull = true;
    }
    return hasNull ? null : true;
  }

  if (op === LogicalOperator.OR) {
    let hasNull = false;
    for (const item of activeConditions) {
      const passes = isRuleGroup(item)
        ? evaluateRuleGroup(item, barIndex, candles, cache)
        : evaluateConditionRule(item, barIndex, candles, cache);
      if (passes === true) return true;
      if (passes === null) hasNull = true;
    }
    return hasNull ? null : false;
  }

  if (op === LogicalOperator.NOT) {
    for (const item of activeConditions) {
      const passes = isRuleGroup(item)
        ? evaluateRuleGroup(item, barIndex, candles, cache)
        : evaluateConditionRule(item, barIndex, candles, cache);
      if (passes === null) return null; // Missing/unavailable data does not invert to true!
      if (passes === true) return false;
    }
    return true;
  }

  return false;
}

function isRuleGroup(item: ConditionRule | RuleGroup): item is RuleGroup {
  return 'operator' in item && Array.isArray((item as RuleGroup).conditions);
}

export interface AstEvaluationResult {
  bullishSignal: boolean;
  bearishSignal: boolean;
  isWarmedUp: boolean;
  details?: Record<string, any>;
}

/**
 * Top-level evaluation function for a Strategy AST at a specific candle index.
 */
export function evaluateStrategyAst(
  astConfig: StrategyAstConfig,
  barIndex: number,
  candles: Candle[],
  cache: EvaluatorCache,
): AstEvaluationResult {
  if (barIndex < cache.warmupRequired || barIndex < 2) {
    return {
      bullishSignal: false,
      bearishSignal: false,
      isWarmedUp: false,
    };
  }

  const direction = astConfig.direction ?? TradeDirection.BOTH;
  let bullish = false;
  let bearish = false;

  if (direction === TradeDirection.BULLISH || direction === TradeDirection.BOTH) {
    if (astConfig.bullishEntry) {
      bullish = evaluateRuleGroup(astConfig.bullishEntry, barIndex, candles, cache) === true;
    }
  }

  if (direction === TradeDirection.BEARISH || direction === TradeDirection.BOTH) {
    if (astConfig.bearishEntry) {
      bearish = evaluateRuleGroup(astConfig.bearishEntry, barIndex, candles, cache) === true;
    }
  }

  const confirming = astConfig.entryRules?.confirmingCandles ?? 1;
  if (confirming > 1) {
    for (let offset = 1; offset < confirming; offset++) {
      const prevBullish = barIndex - offset >= cache.warmupRequired && evaluateRuleGroup(astConfig.bullishEntry, barIndex - offset, candles, cache) === true;
      const prevBearish = barIndex - offset >= cache.warmupRequired && evaluateRuleGroup(astConfig.bearishEntry, barIndex - offset, candles, cache) === true;
      bullish = bullish && prevBullish;
      bearish = bearish && prevBearish;
    }
  }

  return {
    bullishSignal: bullish,
    bearishSignal: bearish,
    isWarmedUp: true,
  };
}

/**
 * Adapts a legacy StrategyConfig (without astConfig) into a unified StrategyAstConfig
 * ensuring a single shared deterministic engine executes all strategies.
 */
export function convertLegacyStrategyToAst(strategy: StrategyConfig): StrategyAstConfig {
  if (strategy.astConfig) {
    return strategy.astConfig;
  }

  const emaPeriod = strategy.entry?.emaPeriod ?? 20;
  const rsiPeriod = strategy.entry?.rsiPeriod ?? 14;
  const rsiThreshold = strategy.entry?.rsiThreshold ?? 55;

  const allowed = (strategy.allowedInstruments as any[]) ?? [];
  const hasCall = allowed.some((i) => String(i).toUpperCase().includes('CALL') || String(i).toUpperCase().includes('CE'));
  const hasPut = allowed.some((i) => String(i).toUpperCase().includes('PUT') || String(i).toUpperCase().includes('PE'));
  const rawSelection = (strategy.selection as any) ?? {};
  const optionType = rawSelection.optionType?.toUpperCase();

  let direction = TradeDirection.BULLISH;
  let optionSide: 'LONG_CE' | 'LONG_PE' | 'BOTH' = 'LONG_CE';

  if ((hasPut && !hasCall) || optionType === 'PE') {
    direction = TradeDirection.BEARISH;
    optionSide = 'LONG_PE';
  } else if ((hasPut && hasCall) || optionType === 'BOTH') {
    direction = TradeDirection.BOTH;
    optionSide = 'BOTH';
  }

  const bullishEntry = (direction === TradeDirection.BULLISH || direction === TradeDirection.BOTH)
    ? {
        id: 'legacy_bullish_group',
        operator: LogicalOperator.AND,
        enabled: true,
        conditions: [
          {
            id: 'cond_price_gt_ema',
            left: { type: 'CANDLE_FIELD' as const, field: 'close' as const, offset: 0 },
            comparison: ComparisonOperator.GT,
            right: { type: 'INDICATOR' as const, indicatorId: 'ema_trend', offset: 0 },
            enabled: true,
            description: `Close above EMA ${emaPeriod}`,
          },
          {
            id: 'cond_rsi_threshold',
            left: { type: 'INDICATOR' as const, indicatorId: 'rsi_filter', offset: 0 },
            comparison: ComparisonOperator.GTE,
            right: { type: 'NUMBER' as const, value: rsiThreshold },
            enabled: true,
            description: `RSI >= ${rsiThreshold}`,
          },
        ],
      }
    : undefined;

  const bearishEntry = (direction === TradeDirection.BEARISH || direction === TradeDirection.BOTH)
    ? {
        id: 'legacy_bearish_group',
        operator: LogicalOperator.AND,
        enabled: true,
        conditions: [
          {
            id: 'cond_price_lt_ema',
            left: { type: 'CANDLE_FIELD' as const, field: 'close' as const, offset: 0 },
            comparison: ComparisonOperator.LT,
            right: { type: 'INDICATOR' as const, indicatorId: 'ema_trend', offset: 0 },
            enabled: true,
            description: `Close below EMA ${emaPeriod}`,
          },
          {
            id: 'cond_rsi_bear_threshold',
            left: { type: 'INDICATOR' as const, indicatorId: 'rsi_filter', offset: 0 },
            comparison: ComparisonOperator.LTE,
            right: { type: 'NUMBER' as const, value: 100 - rsiThreshold },
            enabled: true,
            description: `RSI <= ${100 - rsiThreshold}`,
          },
        ],
      }
    : undefined;

  const rawExit = (strategy.exit as any) ?? {};
  let stopLossBasis: any = rawExit.stopLossBasis;
  if (!stopLossBasis) {
    if (
      rawExit.stopLossType === 'UNDERLYING_POINTS' ||
      rawExit.stopBasis === 'UNDERLYING_LEVEL'
    ) {
      stopLossBasis = 'UNDERLYING_POINTS';
    } else if (rawExit.stopLossType === 'PERCENTAGE') {
      stopLossBasis = 'PERCENTAGE';
    } else {
      stopLossBasis = 'OPTION_PREMIUM';
    }
  }

  let targetProfitBasis: any = rawExit.targetProfitBasis;
  if (!targetProfitBasis) {
    if (
      rawExit.targetProfitType === 'UNDERLYING_POINTS' ||
      rawExit.targetBasis === 'UNDERLYING_LEVEL'
    ) {
      targetProfitBasis = 'UNDERLYING_POINTS';
    } else if (rawExit.targetProfitType === 'PERCENTAGE') {
      targetProfitBasis = 'PERCENTAGE';
    } else {
      targetProfitBasis = 'OPTION_PREMIUM';
    }
  }

  return {
    category: 'TREND',
    direction,
    indicators: [
      {
        id: 'ema_trend',
        type: IndicatorType.EMA,
        period: emaPeriod,
        source: 'close',
      },
      {
        id: 'rsi_filter',
        type: IndicatorType.RSI,
        period: rsiPeriod,
        source: 'close',
      },
    ],
    bullishEntry: bullishEntry ?? {
      id: 'legacy_bullish_group',
      operator: LogicalOperator.AND,
      enabled: false,
      conditions: [],
    },
    bearishEntry,
    entryRules: {
      candleCloseConfirmation: true,
      confirmingCandles: 1,
    },
    contractSelection: {
      instrumentType: 'OPTIONS',
      optionSide,
      underlying: strategy.underlying || 'NIFTY',
      expiry: (strategy.selection?.expiry as any) || 'NEAREST_ELIGIBLE',
      strikeSelection: StrikeSelection.ATM,
      strikeDistance: 0,
      minVolume: strategy.selection?.minVolume ?? 1000,
      maxBidAskSpreadPct: strategy.entry?.maxBidAskSpreadPct ?? 1.0,
      minPremium: 25,
      maxPremium: 600,
    },
    exitRules: {
      stopLossBasis,
      stopLossValue: rawExit.stopLossPoints ?? rawExit.stopLossPct,
      targetProfitBasis,
      targetProfitValue: rawExit.targetPoints ?? rawExit.profitTargetPct,
      marketCutoffTime: strategy.exit?.marketCutoff ?? '15:10',
      exitOnOppositeSignal: false,
      exitOnIndicatorReversal: false,
    },
    trailingProfit: {
      enabled: true,
      mode: 'FIXED_STEP' as any,
      activationProfitInr: 150,
      trailingGapInr: 50,
    },
  };
}
