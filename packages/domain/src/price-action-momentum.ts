import {
  BacktestResult,
  BacktestTradeRecord,
  PriceActionMomentumConfig,
  PriceActionMomentumConfigSchema,
  PriceActionMomentumSignalResult,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle } from './indicators';
import { getStandardLotSize } from './lot-size';
import { isMarketOpenForTrading } from './market-calendar';

export interface PriceActionMomentumEvaluationInput {
  /** Completed 1-minute candles in chronological order. Last candle is the setup candle. */
  oneMinuteCandles: Candle[];
  /** Optional completed 5-minute candles for multi-timeframe confirmation. */
  fiveMinuteCandles?: Candle[];
  /** Current underlying index live price (to check breakout beyond setup candle high/low). */
  currentPrice: number;
  /** Strategy configuration parameters. */
  config?: Partial<PriceActionMomentumConfig>;
  /** Timestamp of the last emitted signal to prevent duplicates on the same candle. */
  lastSignalTimestamp?: string | number;
}

export interface MarketStructureResult {
  bullishConfirmations: number;
  bearishConfirmations: number;
  transitionsEvaluated: number;
}

export interface MultiTimeframeResult {
  mtfConfirmed: boolean;
  mtfPriceChange: number;
  mtfDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

/**
 * Phase 2: Price Direction calculation across the candle window.
 * priceChange = lastCandle.close - firstCandle.close
 */
export function calculatePriceChange(candles: Candle[]): {
  priceChange: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
} {
  if (candles.length < 2) {
    return { priceChange: 0, direction: 'NEUTRAL' };
  }
  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  const priceChange = Number((lastCandle.close - firstCandle.close).toFixed(4));

  if (priceChange > 0) return { priceChange, direction: 'BULLISH' };
  if (priceChange < 0) return { priceChange, direction: 'BEARISH' };
  return { priceChange: 0, direction: 'NEUTRAL' };
}

/**
 * Phase 3: Directional Efficiency calculation.
 * totalMovement = SUM(ABS(close[i] - close[i-1]))
 * trendEfficiency = ABS(priceChange) / totalMovement
 */
export function calculateTotalMovement(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  let totalMovement = 0;
  for (let i = 1; i < candles.length; i++) {
    totalMovement += Math.abs(candles[i]!.close - candles[i - 1]!.close);
  }
  return Number(totalMovement.toFixed(4));
}

export function calculateTrendEfficiency(priceChange: number, totalMovement: number): number {
  if (totalMovement <= 0 || !Number.isFinite(totalMovement)) {
    return 0;
  }
  const efficiency = Math.abs(priceChange) / totalMovement;
  return Number(Math.min(1.0, Math.max(0.0, efficiency)).toFixed(4));
}

/**
 * Phase 4: Market Structure confirmation.
 * Bullish transition: current.high > previous.high AND current.low > previous.low (Higher High & Higher Low)
 * Bearish transition: current.high < previous.high AND current.low < previous.low (Lower High & Lower Low)
 */
export function evaluateMarketStructure(candles: Candle[]): MarketStructureResult {
  if (candles.length < 2) {
    return { bullishConfirmations: 0, bearishConfirmations: 0, transitionsEvaluated: 0 };
  }

  let bullishConfirmations = 0;
  let bearishConfirmations = 0;
  const transitionsEvaluated = candles.length - 1;

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;

    if (curr.high > prev.high && curr.low > prev.low) {
      bullishConfirmations++;
    }
    if (curr.high < prev.high && curr.low < prev.low) {
      bearishConfirmations++;
    }
  }

  return {
    bullishConfirmations,
    bearishConfirmations,
    transitionsEvaluated,
  };
}

/**
 * Helper: Aggregate completed 1-minute candles into 5-minute candles without lookahead bias.
 */
export function aggregateTo5MinuteCandles(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const buckets = new Map<number, Candle[]>();

  for (const c of candles) {
    const timeMs = Number(new Date(c.timestamp));
    // 5 minutes = 300,000 ms
    const bucketKey = Math.floor(timeMs / 300000) * 300000;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(c);
  }

  const result: Candle[] = [];
  for (const [bucketTime, bucketCandles] of buckets.entries()) {
    // Only count completed 5m bars (must contain 5 1m candles to be considered complete)
    if (bucketCandles.length >= 5) {
      const open = bucketCandles[0]!.open;
      const close = bucketCandles[bucketCandles.length - 1]!.close;
      const high = Math.max(...bucketCandles.map((b) => b.high));
      const low = Math.min(...bucketCandles.map((b) => b.low));
      const volume = bucketCandles.reduce((acc, b) => acc + (b.volume || 0), 0);
      result.push({
        timestamp: new Date(bucketTime).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });
    }
  }

  return result.sort((a, b) => Number(new Date(a.timestamp)) - Number(new Date(b.timestamp)));
}

/**
 * Phase 5: Multi-Timeframe Confirmation against completed 5-minute candles.
 */
export function evaluateMultiTimeframeTrend(
  fiveMinuteCandles: Candle[],
  lookback = 3,
): MultiTimeframeResult {
  if (fiveMinuteCandles.length < 2) {
    return { mtfConfirmed: false, mtfPriceChange: 0, mtfDirection: 'NEUTRAL' };
  }

  const window = fiveMinuteCandles.slice(-Math.max(2, lookback));
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const mtfPriceChange = Number((last.close - first.close).toFixed(4));

  let mtfDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (mtfPriceChange > 0) mtfDirection = 'BULLISH';
  else if (mtfPriceChange < 0) mtfDirection = 'BEARISH';

  return {
    mtfConfirmed: mtfDirection !== 'NEUTRAL',
    mtfPriceChange,
    mtfDirection,
  };
}

/**
 * Main Evaluation Engine: Evaluates raw OHLC price action directional momentum.
 */
export function evaluatePriceActionMomentum(
  input: PriceActionMomentumEvaluationInput,
): PriceActionMomentumSignalResult {
  const config = PriceActionMomentumConfigSchema.parse(input.config ?? {});
  const { oneMinuteCandles, currentPrice, lastSignalTimestamp } = input;
  const reasons: string[] = [];
  const nowIso = new Date().toISOString();

  const candleCount = config.candleCount;
  if (oneMinuteCandles.length < candleCount) {
    return {
      signal: 'NO_TRADE',
      direction: 'NEUTRAL',
      priceChange: 0,
      totalMovement: 0,
      trendEfficiency: 0,
      bullishStructureConfirmations: 0,
      bearishStructureConfirmations: 0,
      mtfConfirmed: false,
      breakoutTriggered: false,
      setupCandleHigh: currentPrice,
      setupCandleLow: currentPrice,
      currentPrice,
      reasons: [`Insufficient completed candles: need at least ${candleCount}, received ${oneMinuteCandles.length}.`],
      timestamp: nowIso,
    };
  }

  // Phase 1: Take the last N completed candles
  const window = oneMinuteCandles.slice(-candleCount);
  const setupCandle = window[window.length - 1]!;
  const setupCandleTimestamp = String(setupCandle.timestamp);

  // Prevent duplicate signals on the exact same setup candle
  if (lastSignalTimestamp && String(lastSignalTimestamp) === setupCandleTimestamp) {
    return {
      signal: 'NO_TRADE',
      direction: 'NEUTRAL',
      priceChange: 0,
      totalMovement: 0,
      trendEfficiency: 0,
      bullishStructureConfirmations: 0,
      bearishStructureConfirmations: 0,
      mtfConfirmed: false,
      breakoutTriggered: false,
      setupCandleHigh: setupCandle.high,
      setupCandleLow: setupCandle.low,
      currentPrice,
      reasons: ['Duplicate signal prevention: setup candle was already evaluated.'],
      timestamp: nowIso,
    };
  }

  // Phase 2: Price Direction
  const { priceChange, direction } = calculatePriceChange(window);

  // Phase 3: Directional Efficiency
  const totalMovement = calculateTotalMovement(window);
  const trendEfficiency = calculateTrendEfficiency(priceChange, totalMovement);

  // Phase 4: Market Structure Confirmations
  const structure = evaluateMarketStructure(window);

  // Phase 5: Multi-Timeframe Confirmation (Optional)
  let mtfConfirmed = true;
  let mtfPriceChange: number | undefined;

  if (config.useMultiTimeframeConfirmation) {
    const fiveMinCandles = input.fiveMinuteCandles && input.fiveMinuteCandles.length >= 2
      ? input.fiveMinuteCandles
      : aggregateTo5MinuteCandles(oneMinuteCandles);

    const mtf = evaluateMultiTimeframeTrend(fiveMinCandles, config.mtfLookbackCandles);
    mtfPriceChange = mtf.mtfPriceChange;

    if (direction === 'BULLISH' && mtf.mtfDirection !== 'BULLISH') {
      mtfConfirmed = false;
      reasons.push(`Multi-timeframe disagreement: 1m is BULLISH but 5m trend is ${mtf.mtfDirection}.`);
    } else if (direction === 'BEARISH' && mtf.mtfDirection !== 'BEARISH') {
      mtfConfirmed = false;
      reasons.push(`Multi-timeframe disagreement: 1m is BEARISH but 5m trend is ${mtf.mtfDirection}.`);
    }
  }

  // Phase 6: Trading Signals & Breakout Confirmation
  let signal: 'BUY_CE' | 'BUY_PE' | 'NO_TRADE' = 'NO_TRADE';
  let breakoutTriggered = false;

  const efficiencyPassed = trendEfficiency >= config.minimumEfficiency;
  if (!efficiencyPassed) {
    reasons.push(`Trend efficiency (${trendEfficiency.toFixed(2)}) is below threshold (${config.minimumEfficiency.toFixed(2)}).`);
  }

  if (direction === 'BULLISH') {
    const structurePassed = structure.bullishConfirmations >= config.minimumStructureConfirmations;
    if (!structurePassed) {
      reasons.push(`Bullish structure confirmations (${structure.bullishConfirmations}/${structure.transitionsEvaluated}) below required (${config.minimumStructureConfirmations}).`);
    }

    // Breakout: Current price breaks above setup candle high
    breakoutTriggered = currentPrice > setupCandle.high;
    if (!breakoutTriggered) {
      reasons.push(`Breakout not triggered: current price (${currentPrice}) <= setup candle high (${setupCandle.high}).`);
    }

    if (efficiencyPassed && structurePassed && mtfConfirmed && breakoutTriggered) {
      signal = 'BUY_CE';
      reasons.push('BUY CE signal confirmed: Bullish price action, efficiency, structure, and breakout verified.');
    }
  } else if (direction === 'BEARISH') {
    const structurePassed = structure.bearishConfirmations >= config.minimumStructureConfirmations;
    if (!structurePassed) {
      reasons.push(`Bearish structure confirmations (${structure.bearishConfirmations}/${structure.transitionsEvaluated}) below required (${config.minimumStructureConfirmations}).`);
    }

    // Breakout: Current price breaks below setup candle low
    breakoutTriggered = currentPrice < setupCandle.low;
    if (!breakoutTriggered) {
      reasons.push(`Breakout not triggered: current price (${currentPrice}) >= setup candle low (${setupCandle.low}).`);
    }

    if (efficiencyPassed && structurePassed && mtfConfirmed && breakoutTriggered) {
      signal = 'BUY_PE';
      reasons.push('BUY PE signal confirmed: Bearish price action, efficiency, structure, and breakout verified.');
    }
  } else {
    reasons.push('Neutral price change: price did not move over the lookback window.');
  }

  return {
    signal,
    direction,
    priceChange,
    totalMovement,
    trendEfficiency,
    bullishStructureConfirmations: structure.bullishConfirmations,
    bearishStructureConfirmations: structure.bearishConfirmations,
    mtfConfirmed,
    mtfPriceChange,
    breakoutTriggered,
    setupCandleHigh: setupCandle.high,
    setupCandleLow: setupCandle.low,
    currentPrice,
    reasons,
    timestamp: nowIso,
  };
}

/**
 * Phase 9: Historical Backtesting Engine for Price Action Directional Momentum Strategy.
 */
export interface PriceActionMomentumBacktestOptions {
  candles: Candle[];
  config?: Partial<PriceActionMomentumConfig>;
  initialCapital?: number;
  lotSize?: number;
  tickSize?: number;
}

export function runPriceActionMomentumBacktest(
  options: PriceActionMomentumBacktestOptions,
): BacktestResult & {
  expectancy: number;
  averageProfit: number;
  averageLoss: number;
  trendingMarketTrades: number;
  rangingMarketTrades: number;
} {
  const config = PriceActionMomentumConfigSchema.parse(options.config ?? {});
  const lotSize = options.lotSize ?? getStandardLotSize(config.underlying);
  const tickSize = options.tickSize ?? 0.05;
  const initialCapital = options.initialCapital ?? 10000;
  const candleCount = config.candleCount;

  let candles = [...options.candles].sort(
    (a, b) => Number(new Date(a.timestamp)) - Number(new Date(b.timestamp)),
  );

  const fromDate = candles[0] ? new Date(candles[0].timestamp).toISOString() : new Date().toISOString();
  const toDate = candles[candles.length - 1]
    ? new Date(candles[candles.length - 1]!.timestamp).toISOString()
    : fromDate;

  const emptyResult = {
    strategyId: 'tpl_price_action_momentum',
    strategyName: 'Price Action Directional Momentum Strategy',
    version: 1,
    periodDays: Math.max(1, Math.ceil((Date.parse(toDate) - Date.parse(fromDate)) / 86400000)),
    timeframe: '1m',
    fromDate,
    toDate,
    dataSource: 'MODELED_OPTIONS_ON_PRICE_ACTION_MOMENTUM',
    modelAssumptions: [
      'Raw OHLC price action directional momentum without EMA/SMA indicators.',
      'Options premium modeled at 0.55% spot with 0.5 delta.',
      'Includes exchange turnover, STT, GST, stamp duty, and SEBI charges.',
    ],
    initialCapital,
    finalCapital: initialCapital,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRatePct: 0,
    grossPnl: 0,
    totalCharges: 0,
    netPnl: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
    trades: [] as BacktestTradeRecord[],
    expectancy: 0,
    averageProfit: 0,
    averageLoss: 0,
    trendingMarketTrades: 0,
    rangingMarketTrades: 0,
  };

  if (candles.length < candleCount + 2) {
    return emptyResult;
  }

  const fiveMinCandles = config.useMultiTimeframeConfirmation
    ? aggregateTo5MinuteCandles(candles)
    : [];

  const trades: BacktestTradeRecord[] = [];
  let capital = initialCapital;
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let day = '';
  let dailyPnl = 0;
  let dailyTradesCount = 0;
  let lastExitIndex = -Infinity;
  let trendingMarketTrades = 0;
  let rangingMarketTrades = 0;

  let activeTrade: {
    entryIndex: number;
    entryTime: string;
    entryPrice: number;
    spotEntry: number;
    quantity: number;
    stopLossPrice: number;
    targetPrice: number;
    initialStopPrice: number;
    type: 'CE' | 'PE';
    trailing: boolean;
    peakPrice: number;
    marketEfficiency: number;
  } | null = null;

  const modelOptionPrice = (spot: number, active: typeof activeTrade) => {
    if (!active) return 0;
    const sign = active.type === 'CE' ? 1 : -1;
    const premium = active.entryPrice + sign * (spot - active.spotEntry) * 0.5;
    return Math.max(tickSize, Number(premium.toFixed(2)));
  };

  const settleTrade = (
    exitPrice: number,
    exitTime: string,
    exitReason: string,
    index: number,
  ) => {
    if (!activeTrade) return;
    const grossPnl = Number(((exitPrice - activeTrade.entryPrice) * activeTrade.quantity).toFixed(2));
    const charges = calculateOptionCharges({
      buyPrice: activeTrade.entryPrice,
      sellPrice: exitPrice,
      quantity: activeTrade.quantity,
    }).totalRoundTripCharges;
    const netPnl = Number((grossPnl - charges).toFixed(2));

    capital = Number((capital + netPnl).toFixed(2));
    dailyPnl = Number((dailyPnl + netPnl).toFixed(2));
    peakCapital = Math.max(peakCapital, capital);
    const dd = peakCapital - capital;
    maxDrawdown = Math.max(maxDrawdown, dd);
    maxDrawdownPct = Math.max(maxDrawdownPct, peakCapital > 0 ? (dd / peakCapital) * 100 : 0);

    if (activeTrade.marketEfficiency >= 0.7) {
      trendingMarketTrades++;
    } else {
      rangingMarketTrades++;
    }

    trades.push({
      id: `pam_bt_${trades.length + 1}`,
      entryTime: activeTrade.entryTime,
      exitTime,
      durationMinutes: Math.max(1, Math.round((Date.parse(exitTime) - Date.parse(activeTrade.entryTime)) / 60000)),
      symbol: `${config.underlying} MODELED ATM ${activeTrade.type}`,
      side: 'BUY',
      entryPrice: activeTrade.entryPrice,
      exitPrice: Number(exitPrice.toFixed(2)),
      quantity: activeTrade.quantity,
      grossPnl,
      charges,
      netPnl,
      exitReason,
      initialStopPrice: activeTrade.initialStopPrice,
      trailingStopPrice: activeTrade.trailing ? activeTrade.stopLossPrice : undefined,
    });

    activeTrade = null;
    lastExitIndex = index;
  };

  for (let i = candleCount; i < candles.length; i++) {
    const currentCandle = candles[i]!;
    const currentDay = new Date(currentCandle.timestamp).toISOString().slice(0, 10);

    // Reset daily counters on new session day
    if (currentDay !== day) {
      if (activeTrade && i > 0) {
        const prevCandle = candles[i - 1]!;
        const exitPr = modelOptionPrice(prevCandle.close, activeTrade);
        settleTrade(exitPr, new Date(prevCandle.timestamp).toISOString(), 'SESSION_END', i - 1);
      }
      day = currentDay;
      dailyPnl = 0;
      dailyTradesCount = 0;
    }

    if (!isMarketOpenForTrading(new Date(currentCandle.timestamp))) {
      continue;
    }

    // Active position management
    if (activeTrade) {
      const optionHigh = modelOptionPrice(activeTrade.type === 'CE' ? currentCandle.high : currentCandle.low, activeTrade);
      const optionLow = modelOptionPrice(activeTrade.type === 'CE' ? currentCandle.low : currentCandle.high, activeTrade);
      const optionClose = modelOptionPrice(currentCandle.close, activeTrade);
      const closeTime = new Date(currentCandle.timestamp).toISOString();

      // Check Stop-Loss
      if (optionLow <= activeTrade.stopLossPrice) {
        settleTrade(activeTrade.stopLossPrice, closeTime, activeTrade.trailing ? 'TRAILING_STOP' : 'STOP_LOSS', i);
        continue;
      }

      // Check Target Profit
      if (optionHigh >= activeTrade.targetPrice) {
        settleTrade(activeTrade.targetPrice, closeTime, 'TARGET_PROFIT', i);
        continue;
      }

      // Trailing stop adjustment
      if (config.trailingStopEnabled) {
        activeTrade.peakPrice = Math.max(activeTrade.peakPrice, optionClose);
        const unrealizedNet = (activeTrade.peakPrice - activeTrade.entryPrice) * activeTrade.quantity;
        if (unrealizedNet >= config.trailingActivationProfitInr) {
          activeTrade.trailing = true;
          const trailingPoints = config.trailingStepInr / activeTrade.quantity;
          const newStop = Number((activeTrade.peakPrice - trailingPoints).toFixed(2));
          activeTrade.stopLossPrice = Math.max(activeTrade.stopLossPrice, newStop);
        }
      }
      continue;
    }

    // Cooldown check
    if (i - lastExitIndex < config.cooldownMinutes) {
      continue;
    }

    // Risk daily caps
    if (dailyTradesCount >= config.maxTradesPerDay || dailyPnl <= -config.maxAllInDailyLossInr) {
      continue;
    }

    // Evaluate signal using completed candles up to i-1, and breakout on candle i
    const decisionTimeMs = Number(new Date(currentCandle.timestamp));
    const causalFiveMinCandles = config.useMultiTimeframeConfirmation
      ? fiveMinCandles.filter((c) => Number(new Date(c.timestamp)) + 300000 <= decisionTimeMs)
      : [];

    const completedWindow = candles.slice(i - candleCount, i);
    const evalResult = evaluatePriceActionMomentum({
      oneMinuteCandles: completedWindow,
      fiveMinuteCandles: causalFiveMinCandles,
      currentPrice: currentCandle.close,
      config,
    });

    if (evalResult.signal === 'BUY_CE' || evalResult.signal === 'BUY_PE') {
      const type = evalResult.signal === 'BUY_CE' ? 'CE' : 'PE';
      const spotEntry = currentCandle.close;
      const initialPremium = Number(Math.max(25, spotEntry * 0.0055).toFixed(2));
      const entryPrice = initialPremium;
      const requiredCapital = entryPrice * lotSize;

      // 1. Funding check: cannot enter if position premium exceeds available capital
      if (requiredCapital > capital) {
        continue;
      }

      // Determine Stop Loss
      let stopLossPoints = config.stopLossValue;
      if (config.stopLossType === 'STRUCTURE_BASED') {
        const setupCandle = completedWindow[completedWindow.length - 1]!;
        const spotRisk = type === 'CE'
          ? Math.max(5, spotEntry - setupCandle.low)
          : Math.max(5, setupCandle.high - spotEntry);
        // Delta 0.5 conversion
        stopLossPoints = Number((spotRisk * 0.5).toFixed(2));
      }

      // 2. All-in trade cap check with estimated round-trip charges
      const estimatedRoundTripCharges = calculateOptionCharges({
        buyPrice: entryPrice,
        sellPrice: Math.max(tickSize, entryPrice - stopLossPoints),
        quantity: lotSize,
      }).totalRoundTripCharges;

      const maxGrossRiskInr = Math.max(0, config.maxAllInTradeLossInr - estimatedRoundTripCharges);
      let maxAllowedStopPoints = Math.floor((maxGrossRiskInr / lotSize) / tickSize) * tickSize;
      
      const actualChargesAtStop = calculateOptionCharges({
        buyPrice: entryPrice,
        sellPrice: Math.max(tickSize, entryPrice - maxAllowedStopPoints),
        quantity: lotSize,
      }).totalRoundTripCharges;

      while (maxAllowedStopPoints >= tickSize && maxAllowedStopPoints * lotSize + actualChargesAtStop > config.maxAllInTradeLossInr) {
        maxAllowedStopPoints = Math.max(0, Number((maxAllowedStopPoints - tickSize).toFixed(2)));
      }
      if (maxAllowedStopPoints < tickSize) {
        continue;
      }
      stopLossPoints = Math.min(stopLossPoints, maxAllowedStopPoints);
      const stopLossPrice = Math.max(tickSize, Number((entryPrice - stopLossPoints).toFixed(2)));

      // 3. Daily loss allowance check
      const remainingDailyBudget = config.maxAllInDailyLossInr + dailyPnl;
      if (stopLossPoints * lotSize + estimatedRoundTripCharges > remainingDailyBudget) {
        continue;
      }

      // Determine Target Profit
      const targetPoints = config.targetProfitType === 'RISK_REWARD'
        ? Number((stopLossPoints * config.riskRewardRatio).toFixed(2))
        : config.targetPoints;
      const targetPrice = Number((entryPrice + targetPoints).toFixed(2));

      activeTrade = {
        entryIndex: i,
        entryTime: new Date(currentCandle.timestamp).toISOString(),
        entryPrice,
        spotEntry,
        quantity: lotSize,
        stopLossPrice,
        targetPrice,
        initialStopPrice: stopLossPrice,
        type,
        trailing: false,
        peakPrice: entryPrice,
        marketEfficiency: evalResult.trendEfficiency,
      };

      dailyTradesCount++;
    }
  }

  // Settle any remaining active trade at last candle
  if (activeTrade && candles.length > 0) {
    const last = candles[candles.length - 1]!;
    const exitPr = modelOptionPrice(last.close, activeTrade);
    settleTrade(exitPr, new Date(last.timestamp).toISOString(), 'BACKTEST_END', candles.length - 1);
  }

  // Calculate backtest metrics
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.netPnl > 0).length;
  const losingTrades = trades.filter((t) => t.netPnl <= 0).length;
  const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(2)) : 0;
  const grossPnl = Number(trades.reduce((sum, t) => sum + t.grossPnl, 0).toFixed(2));
  const totalCharges = Number(trades.reduce((sum, t) => sum + t.charges, 0).toFixed(2));
  const netPnl = Number((grossPnl - totalCharges).toFixed(2));

  const totalWins = trades.filter((t) => t.netPnl > 0).reduce((sum, t) => sum + t.netPnl, 0);
  const totalLosses = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((sum, t) => sum + t.netPnl, 0));
  const profitFactor = totalLosses > 0 ? Number((totalWins / totalLosses).toFixed(2)) : totalWins > 0 ? 99.99 : 0;

  const averageProfit = winningTrades > 0 ? Number((totalWins / winningTrades).toFixed(2)) : 0;
  const averageLoss = losingTrades > 0 ? Number((totalLosses / losingTrades).toFixed(2)) : 0;
  const winRateRatio = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const lossRateRatio = totalTrades > 0 ? losingTrades / totalTrades : 0;
  const expectancy = Number((winRateRatio * averageProfit - lossRateRatio * averageLoss).toFixed(2));

  return {
    ...emptyResult,
    finalCapital: Number((initialCapital + netPnl).toFixed(2)),
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct,
    grossPnl,
    totalCharges,
    netPnl,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    profitFactor,
    trades,
    expectancy,
    averageProfit,
    averageLoss,
    trendingMarketTrades,
    rangingMarketTrades,
  };
}
