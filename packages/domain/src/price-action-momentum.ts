import {
  BacktestResult,
  BacktestTradeRecord,
  PriceActionMomentumConfig,
  PriceActionMomentumConfigSchema,
  PriceActionMomentumSignalResult,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle } from './indicators';
import { getDatedLotSize } from './lot-size';
import { isMarketOpenForTrading, isCalendarVerifiedForDate, getIstDateTime } from './market-calendar';

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
  /** Percentage of entry premium lost per 375-minute session while held. */
  thetaDecayPctPerSession?: number;
}

/** Intraday square-off boundary for open PAM positions (IST). */
const PAM_MARKET_CUTOFF = '15:10';

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
  let candles = [...options.candles].sort(
    (a, b) => Number(new Date(a.timestamp)) - Number(new Date(b.timestamp)),
  );
  const lotSize = options.lotSize ?? getDatedLotSize(config.underlying, candles[0]?.timestamp);
  const tickSize = options.tickSize ?? 0.05;
  const initialCapital = options.initialCapital ?? 10000;
  const thetaPct = options.thetaDecayPctPerSession ?? 10;
  const candleCount = config.candleCount;
  const minuteMs = 60000;
  const toTick = (price: number) => Number((Math.round(price / tickSize) * tickSize).toFixed(2));
  const istTime = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

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
      'Options premium modeled at 0.55% spot with 0.5 delta; no IV or gamma modeling.',
      `Time decay modeled at ${thetaPct}% of entry premium per session; expiry-day decay is much faster and is not modeled.`,
      'Entries fill one tick above and exits one tick below the modeled premium; fills are rounded to tick size.',
      `Entries only inside the configured session window; open positions exit at the ${PAM_MARKET_CUTOFF} IST cutoff.`,
      'Includes dated exchange turnover, STT, GST, stamp duty, and SEBI charges.',
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

  const unverifiedCandle = candles.find((c) => !isCalendarVerifiedForDate(new Date(c.timestamp)));
  if (unverifiedCandle) {
    const unverifiedYear = getIstDateTime(new Date(unverifiedCandle.timestamp)).year;
    return {
      ...emptyResult,
      error: `UNSUPPORTED_CALENDAR_YEAR: Historical simulation only supports verified calendar years (2023-2026). Found unverified year: ${unverifiedYear}.`,
    };
  }

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
    entryMs: number;
    entryPrice: number;
    premium: number;
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

  /** Bid-side modeled premium at a point in time: delta move, minus decay while held, minus one tick of spread. */
  const modelOptionPrice = (spot: number, active: typeof activeTrade, atMs: number) => {
    if (!active) return 0;
    const sign = active.type === 'CE' ? 1 : -1;
    const minutesHeld = Math.max(0, (atMs - active.entryMs) / minuteMs);
    const decay = (active.premium * thetaPct) / 100 / 375 * minutesHeld;
    return Math.max(tickSize, toTick(active.premium + sign * (spot - active.spotEntry) * 0.5 - decay - tickSize));
  };

  const settleTrade = (
    exitPrice: number,
    exitTime: string,
    exitReason: string,
    index: number,
  ) => {
    if (!activeTrade) return;
    exitPrice = toTick(exitPrice);
    const grossPnl = Number(((exitPrice - activeTrade.entryPrice) * activeTrade.quantity).toFixed(2));
    const charges = calculateOptionCharges({
      buyPrice: activeTrade.entryPrice,
      sellPrice: exitPrice,
      quantity: activeTrade.quantity,
      date: exitTime,
    }).totalRoundTripCharges;
    const netPnl = Number((grossPnl - charges).toFixed(2));

    capital = Number((capital + netPnl).toFixed(2));
    dailyPnl = Number((dailyPnl + netPnl).toFixed(2));
    if (netPnl < 0) {
      dailyRealizedLoss = Number((dailyRealizedLoss + Math.abs(netPnl)).toFixed(2));
    }
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
      exitPrice,
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

  let lastEligibleCandle: Candle | null = null;
  let dailyRealizedLoss = 0;

  for (let i = candleCount; i < candles.length; i++) {
    const currentCandle = candles[i]!;
    const currentDay = new Date(currentCandle.timestamp).toISOString().slice(0, 10);

    // Reset daily counters on new session day
    if (currentDay !== day) {
      if (activeTrade && lastEligibleCandle) {
        const lastCloseMs = Number(new Date(lastEligibleCandle.timestamp)) + minuteMs;
        const exitPr = modelOptionPrice(lastEligibleCandle.close, activeTrade, lastCloseMs);
        settleTrade(exitPr, new Date(lastCloseMs).toISOString(), 'SESSION_END', i - 1);
      }
      day = currentDay;
      dailyPnl = 0;
      dailyRealizedLoss = 0;
      dailyTradesCount = 0;
    }

    if (!isMarketOpenForTrading(new Date(currentCandle.timestamp))) {
      continue;
    }
    lastEligibleCandle = currentCandle;

    // Active position management
    const candleOpenMs = Number(new Date(currentCandle.timestamp));
    const candleCloseMs = candleOpenMs + minuteMs;
    if (activeTrade) {
      const optionOpen = modelOptionPrice(currentCandle.open, activeTrade, candleOpenMs);
      const optionHigh = modelOptionPrice(activeTrade.type === 'CE' ? currentCandle.high : currentCandle.low, activeTrade, candleCloseMs);
      const optionLow = modelOptionPrice(activeTrade.type === 'CE' ? currentCandle.low : currentCandle.high, activeTrade, candleCloseMs);
      const optionClose = modelOptionPrice(currentCandle.close, activeTrade, candleCloseMs);
      const openTime = new Date(candleOpenMs).toISOString();
      const closeTime = new Date(candleCloseMs).toISOString();

      // Intraday cutoff: exit at the open of the first bar at or after the cutoff.
      if (istTime(candleOpenMs) >= PAM_MARKET_CUTOFF) {
        settleTrade(optionOpen, openTime, 'TIME_CUTOFF', i);
        continue;
      }

      // Check Opening Gap First (B21)
      if (optionOpen >= activeTrade.targetPrice) {
        settleTrade(optionOpen, openTime, 'TARGET_PROFIT', i);
        continue;
      }
      if (optionOpen <= activeTrade.stopLossPrice) {
        settleTrade(optionOpen, openTime, activeTrade.trailing ? 'TRAILING_STOP' : 'STOP_LOSS', i);
        continue;
      }

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

      // Trailing stop adjustment (Net profit activation)
      if (config.trailingStopEnabled) {
        activeTrade.peakPrice = Math.max(activeTrade.peakPrice, optionClose);
        const exitCharges = calculateOptionCharges({
          buyPrice: activeTrade.entryPrice,
          sellPrice: activeTrade.peakPrice,
          quantity: activeTrade.quantity,
        }).totalRoundTripCharges;
        const unrealizedNet = (activeTrade.peakPrice - activeTrade.entryPrice) * activeTrade.quantity - exitCharges;
        if (unrealizedNet >= config.trailingActivationProfitInr) {
          activeTrade.trailing = true;
          const trailingPoints = config.trailingStepInr / activeTrade.quantity;
          const newStop = toTick(activeTrade.peakPrice - trailingPoints);
          activeTrade.stopLossPrice = Math.max(activeTrade.stopLossPrice, newStop);
        }
      }

      // MTM Drawdown update (B14)
      const currentCharges = calculateOptionCharges({
        buyPrice: activeTrade.entryPrice,
        sellPrice: optionClose,
        quantity: activeTrade.quantity,
        date: closeTime,
      }).totalRoundTripCharges;
      const mtmNet = (optionClose - activeTrade.entryPrice) * activeTrade.quantity - currentCharges;
      const currentEquity = capital + mtmNet;
      peakCapital = Math.max(peakCapital, currentEquity);
      const mtmDd = peakCapital - currentEquity;
      maxDrawdown = Math.max(maxDrawdown, mtmDd);
      maxDrawdownPct = Math.max(maxDrawdownPct, peakCapital > 0 ? (mtmDd / peakCapital) * 100 : 0);
      continue;
    }

    // Cooldown check
    if (i - lastExitIndex < config.cooldownMinutes) {
      continue;
    }

    // Session entry window, judged at the bar close where the entry would fill.
    const entryClock = istTime(candleCloseMs);
    if (entryClock < config.session.start || entryClock > config.session.lastEntry || entryClock >= PAM_MARKET_CUTOFF) {
      continue;
    }

    // Risk daily caps (B12: cumulative realized daily loss)
    const remainingDailyBudget = Math.max(0, config.maxAllInDailyLossInr - dailyRealizedLoss);
    if (dailyTradesCount >= config.maxTradesPerDay || remainingDailyBudget <= 0) {
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
      const initialPremium = toTick(Math.max(25, spotEntry * 0.0055));
      const entryPrice = toTick(initialPremium + tickSize);
      const requiredCapital = entryPrice * lotSize;

      // 1. Funding check: cannot enter if position premium exceeds available capital
      if (requiredCapital > capital) {
        continue;
      }

      // Determine Stop Loss (B17: supports PERCENTAGE and STRUCTURE_BASED)
      let stopLossPoints = config.stopLossValue;
      if (config.stopLossType === 'PERCENTAGE') {
        stopLossPoints = Number((entryPrice * (config.stopLossValue / 100)).toFixed(2));
      } else if (config.stopLossType === 'STRUCTURE_BASED') {
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
        date: candleCloseMs,
      }).totalRoundTripCharges;

      const maxGrossRiskInr = Math.max(0, config.maxAllInTradeLossInr - estimatedRoundTripCharges);
      let maxAllowedStopPoints = Math.floor((maxGrossRiskInr / lotSize) / tickSize) * tickSize;
      
      const actualChargesAtStop = calculateOptionCharges({
        buyPrice: entryPrice,
        sellPrice: Math.max(tickSize, entryPrice - maxAllowedStopPoints),
        quantity: lotSize,
        date: candleCloseMs,
      }).totalRoundTripCharges;

      while (maxAllowedStopPoints >= tickSize && maxAllowedStopPoints * lotSize + actualChargesAtStop > config.maxAllInTradeLossInr) {
        maxAllowedStopPoints = Math.max(0, Number((maxAllowedStopPoints - tickSize).toFixed(2)));
      }
      if (maxAllowedStopPoints < tickSize) {
        continue;
      }
      stopLossPoints = Math.min(stopLossPoints, maxAllowedStopPoints);
      const stopLossPrice = Math.max(tickSize, toTick(entryPrice - stopLossPoints));
      if (stopLossPrice >= entryPrice) {
        continue;
      }

      // 3. Daily loss allowance check (B12)
      if (stopLossPoints * lotSize + estimatedRoundTripCharges > remainingDailyBudget) {
        continue;
      }

      // Determine Target Profit (B17: supports RISK_REWARD, PERCENTAGE, FIXED_POINTS)
      let targetPoints = config.targetPoints;
      if (config.targetProfitType === 'RISK_REWARD') {
        targetPoints = Number((stopLossPoints * config.riskRewardRatio).toFixed(2));
      } else if (config.targetProfitType === 'PERCENTAGE') {
        targetPoints = Number((entryPrice * (config.targetPoints / 100)).toFixed(2));
      }
      const targetPrice = toTick(entryPrice + targetPoints);
      if (targetPrice <= entryPrice) {
        continue;
      }

      activeTrade = {
        entryIndex: i,
        // Signal uses this bar's close, so the modeled fill is at the bar close, not its open.
        entryTime: new Date(candleCloseMs).toISOString(),
        entryMs: candleCloseMs,
        entryPrice,
        premium: initialPremium,
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

  // Settle any remaining active trade at last eligible candle (B13)
  if (activeTrade && lastEligibleCandle) {
    const lastCloseMs = Number(new Date(lastEligibleCandle.timestamp)) + minuteMs;
    const exitPr = modelOptionPrice(lastEligibleCandle.close, activeTrade, lastCloseMs);
    settleTrade(exitPr, new Date(lastCloseMs).toISOString(), 'BACKTEST_END', candles.indexOf(lastEligibleCandle));
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
  // B24: undefined (null) with no losing trades; never a sentinel or the summed gains.
  const profitFactor = totalLosses > 0 ? Number((totalWins / totalLosses).toFixed(2)) : totalWins > 0 ? null : 0;

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
