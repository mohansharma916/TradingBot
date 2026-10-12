import { AllowedOptionType, BacktestRequest, BacktestResult, BacktestTradeRecord, StrategyConfig, TrailingProfitMode } from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle } from './indicators';
import { getDatedLotSize } from './lot-size';
import { buildIndicatorCache, convertLegacyStrategyToAst, evaluateStrategyAst } from './strategy-rule-evaluator';
import { strategyExitLevels, strategyTimeframeMinutes } from './strategy-evaluator';
import { isMarketOpenForTrading, isCalendarVerifiedForDate, getIstDateTime } from './market-calendar';

export interface BacktestOptions {
  strategy: StrategyConfig; candles: Candle[]; request?: Partial<BacktestRequest>; dataSource?: string; lotSize?: number; tickSize?: number;
  /** Modeled time decay as a percentage of entry premium lost per full 375-minute session. Expiry days decay far faster. */
  thetaDecayPctPerSession?: number;
}
/** Rough non-expiry-day ATM weekly decay; deliberately disclosed rather than hidden. */
export const DEFAULT_THETA_DECAY_PCT_PER_SESSION = 10;
const SESSION_MINUTES = 375;
const iso = (time: string | number) => new Date(time).toISOString();
const money = (value:number) => Number(value.toFixed(2));
const istTime = (timestamp:string | number) => new Date(Number(new Date(timestamp)) + 330 * 60000).toISOString().slice(11,16);
/** Research simulation of option premiums from underlying candles; never historical option fills. */
export function runStrategyBacktest(options:BacktestOptions):BacktestResult {
  const {strategy,request} = options;
  const timeframe = request?.timeframe ?? strategy.timeframe ?? '5m';
  const interval = strategyTimeframeMinutes(timeframe) * 60000;
  const initialCapital = request?.initialCapital ?? strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? 10000;
  const source = options.dataSource ?? 'CALLER_SUPPLIED_UNVERIFIED_CANDLES';
  const dataSource = `MODELED_OPTIONS_ON_${source}`;
  let candles = [...(options.candles ?? [])].sort((a,b)=>Number(new Date(a.timestamp))-Number(new Date(b.timestamp)));
  const firstCandleDate = candles[0]?.timestamp;
  const lotSize = options.lotSize ?? getDatedLotSize(strategy.underlying, firstCandleDate);
  const tickSize = options.tickSize ?? 0.05;
  const thetaPct = options.thetaDecayPctPerSession ?? DEFAULT_THETA_DECAY_PCT_PER_SESSION;
  const modelAssumptions = [
    'RESEARCH_MODE: Underlying candles drive simulation; all option contracts, prices and fills are modeled.',
    `ATM strike dynamically derived from underlying spot (${strategy.underlying === 'BANKNIFTY' ? '100-pt' : '50-pt'} grid); delta fixed at 0.5; no IV or gamma modeling.`,
    `Time decay modeled at ${thetaPct}% of entry premium per session, linear while held; expiry-day decay is much faster and is not modeled.`,
    'One lot per trade, matching live runtime position sizing.',
    'Historical dated statutory fee schedule applied based on trade session timestamp.',
    'Intrabar known opening gaps execute at open; stops precede targets under intrabar ambiguity.',
    'Market cutoff is strictly enforced; candles spanning cutoff exit at cutoff boundary rather than claiming post-cutoff targets.',
    'Simulated performance on modeled options does not establish a verified profitable live trading edge.',
  ];
  let tradeStartMs = -Infinity;
  let tradeEndMs = Infinity;
  let fromDate = candles[0] ? iso(candles[0].timestamp) : new Date().toISOString();
  let toDate = candles.at(-1) ? iso(candles.at(-1)!.timestamp) : fromDate;

  if (request?.fromDate || request?.toDate) {
    const dates = [(request.fromDate ?? request.toDate)!.slice(0,10),(request.toDate ?? request.fromDate)!.slice(0,10)].sort();
    tradeStartMs = Date.parse(`${dates[0]}T00:00:00+05:30`);
    tradeEndMs = Date.parse(`${dates[1]}T23:59:59.999+05:30`);
    fromDate = `${dates[0]}T00:00:00.000Z`;
    toDate = `${dates[1]}T23:59:59.999Z`;
  }
  const runId = `bt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const dataFingerprint = `${candles.length}_bars:${candles[0]?.timestamp ?? 'none'}..${candles.at(-1)?.timestamp ?? 'none'}`;
  const empty:BacktestResult = {
    strategyId:strategy.id,
    strategyName:strategy.name,
    version:strategy.version,
    periodDays:Math.max(1,Math.ceil((Date.parse(toDate)-Date.parse(fromDate))/86400000)),
    timeframe,
    fromDate,
    toDate,
    dataSource,
    modelAssumptions,
    runId,
    dataFingerprint,
    effectiveLotSize: lotSize,
    effectiveTickSize: tickSize,
    effectiveStrategyConfig: strategy as any,
    equityCurve: [{ timestamp: fromDate, equity: initialCapital }],
    initialCapital,
    finalCapital:initialCapital,
    totalTrades:0,
    winningTrades:0,
    losingTrades:0,
    winRatePct:0,
    grossPnl:0,
    totalCharges:0,
    netPnl:0,
    maxDrawdown:0,
    maxDrawdownPct:0,
    profitFactor:0,
    trades:[],
  };
  if (!Number.isFinite(thetaPct) || thetaPct<0) return {...empty,error:'Theta decay percentage must be a nonnegative number.'};
  if (!Number.isInteger(lotSize) || lotSize<=0 || !Number.isFinite(tickSize) || tickSize<=0 || !interval || !Number.isFinite(initialCapital) || initialCapital<=0) return {...empty,error:'Valid timeframe, capital and authoritative lot/tick metadata are required.'};
  if (candles.some((c,i)=>!Number.isFinite(Number(new Date(c.timestamp))) || ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low<=0 || c.high<Math.max(c.open,c.close) || c.low>Math.min(c.open,c.close) || c.volume<0 || (i>0 && Number(new Date(c.timestamp))===Number(new Date(candles[i-1]!.timestamp))))) return {...empty,error:'Invalid or duplicate underlying candles.'};
  if (candles.length<3) return empty;

  // Calendar verification (B07): reject unverified years explicitly
  const unverifiedCandle = candles.find(c => !isCalendarVerifiedForDate(new Date(c.timestamp)));
  if (unverifiedCandle) {
    const unverifiedYear = getIstDateTime(new Date(unverifiedCandle.timestamp)).year;
    return {
      ...empty,
      error: `UNSUPPORTED_CALENDAR_YEAR: Historical simulation only supports verified calendar years (2023-2026). Found unverified year: ${unverifiedYear}.`,
    };
  }

  if (interval >= 86400000) return {...empty,error:'This intraday premium model requires intraday candles; daily bars cannot determine session entry and exits.'};
  const minimumPremium=Math.min(...candles.map(c=>money(Math.max(25,c.open*0.0055)+tickSize)));
  const minimumCharges=calculateOptionCharges({buyPrice:minimumPremium,sellPrice:minimumPremium,quantity:lotSize,date:firstCandleDate}).totalRoundTripCharges;
  if (initialCapital<minimumPremium*lotSize+minimumCharges+2*tickSize*lotSize) return {...empty,error:'Insufficient capital for one reference lot including estimated round-trip charges and spread reserve.'};
  const ast = convertLegacyStrategyToAst(strategy);
  if ((ast.indicators ?? []).some(ind=>ind.timeframe && ind.timeframe!==timeframe)) return {...empty,error:'Mixed indicator timeframes are unsupported; aligned source data is required.'};
  if (ast.contractSelection?.instrumentType==='FUTURES' || ast.exitRules?.exitOnIndicatorReversal) return {...empty,error:'Futures and generic indicator-reversal exits require a dedicated price/execution model.'};
  const useTrailing = request?.useTrailingStop !== undefined ? request.useTrailingStop : (ast.trailingProfit?.enabled ?? false);
  if (useTrailing && ast.trailingProfit?.mode && ast.trailingProfit.mode!==TrailingProfitMode.FIXED_STEP) return {...empty,error:'Only fixed-step trailing is supported by this modeled backtest.'};

  // Build indicator cache over the full dataset (including warmup padding)
  const cache = buildIndicatorCache(candles,ast,{timeframeMinutes:interval/60000,candleTimestampBasis:'OPEN'});

  // Check warmup sufficiency (B11)
  if (candles.length < cache.warmupRequired) {
    return {
      ...empty,
      error: `INSUFFICIENT_WARMUP: Dataset contains ${candles.length} bars, but strategy requires at least ${cache.warmupRequired} warmup bars.`,
    };
  }
  const maxDaily = Math.min(request?.maxDailyLossInr ?? Infinity,strategy.risk?.maxAllInDailyLossInr ?? strategy.maxAllInDailyLossInr ?? 600);
  const maxTrade = Math.min(request?.maxTradeLossInr ?? Infinity,strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 500);
  const maxTrades = Math.min(request?.maxTradesPerDay ?? Infinity,strategy.risk?.maxTradesPerDay ?? 3);
  const maxCapital = strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? initialCapital;
  const cutoff = ast.exitRules?.marketCutoffTime ?? strategy.exit?.marketCutoff ?? '15:10';
  const activation = request?.trailingActivationProfitInr !== undefined ? request.trailingActivationProfitInr : (ast.trailingProfit?.activationProfitInr ?? 150);
  const gap = request?.trailingStepInr !== undefined ? request.trailingStepInr : (ast.trailingProfit?.trailingGapInr ?? ast.trailingProfit?.adjustmentStepInr ?? 50);
  const toTick = (price: number, tick = tickSize) => Number((Math.round(price / tick) * tick).toFixed(2));

  const trades: BacktestTradeRecord[] = [];
  const equityCurve: { timestamp: string; equity: number }[] = [
    { timestamp: fromDate, equity: initialCapital },
  ];
  let capital = initialCapital,
    peakEquity = initialCapital,
    drawdown = 0,
    drawdownPct = 0,
    day = '',
    dailyRealizedLoss = 0,
    count = 0,
    lastExitIndex = -Infinity,
    signalWaveEntered = false,
    lastEligibleCandle: Candle | null = null;

  let active: {
    entryIndex: number;
    entryTime: string;
    entryMs: number;
    entry: number;
    premium: number;
    spot: number;
    quantity: number;
    stop: number;
    initialStop: number;
    target: number;
    type: 'CE' | 'PE';
    trailing: boolean;
    peakClose: number;
  } | null = null;

  const prices = (c: Candle) => {
    const t = active!;
    const sign = t.type === 'CE' ? 1 : -1;
    const thetaPerMinute = (t.premium * thetaPct) / 100 / SESSION_MINUTES;
    const openMinutes = Math.max(0, (Number(new Date(c.timestamp)) - t.entryMs) / 60000);
    const closeMinutes = openMinutes + interval / 60000;
    // Bid-side value: delta move, minus decay while held, minus one tick of spread.
    const premium = (spot: number, minutes: number) => Math.max(tickSize, t.premium + sign * (spot - t.spot) * 0.5 - thetaPerMinute * minutes - tickSize);
    return {
      open: toTick(premium(c.open, openMinutes)),
      // Intrabar extremes use end-of-bar decay: pessimistic for both target and stop checks.
      high: toTick(premium(t.type === 'CE' ? c.high : c.low, closeMinutes)),
      low: toTick(premium(t.type === 'CE' ? c.low : c.high, closeMinutes)),
      close: toTick(premium(c.close, closeMinutes)),
    };
  };

  const settle = (rawPrice: number, timestamp: string, reason: string, index: number) => {
    const t = active!;
    const price = toTick(rawPrice);
    const grossPnl = money((price - t.entry) * t.quantity);
    const charges = calculateOptionCharges({ buyPrice: t.entry, sellPrice: price, quantity: t.quantity, date: timestamp }).totalRoundTripCharges;
    const netPnl = money(grossPnl - charges);
    capital = money(capital + netPnl);
    if (netPnl < 0) {
      dailyRealizedLoss = money(dailyRealizedLoss + Math.abs(netPnl));
    }
    peakEquity = Math.max(peakEquity, capital);
    drawdown = Math.max(drawdown, peakEquity - capital);
    drawdownPct = Math.max(drawdownPct, peakEquity > 0 ? ((peakEquity - capital) / peakEquity) * 100 : 0);
    equityCurve.push({ timestamp, equity: capital });
    trades.push({
      id: `bt_${trades.length + 1}`,
      entryTime: t.entryTime,
      exitTime: timestamp,
      durationMinutes: Math.max(0, (Date.parse(timestamp) - Date.parse(t.entryTime)) / 60000),
      symbol: `${strategy.underlying} MODELED ATM ${t.type}`,
      side: 'BUY',
      entryPrice: t.entry,
      exitPrice: price,
      quantity: t.quantity,
      grossPnl,
      charges,
      netPnl,
      exitReason: reason,
      initialStopPrice: t.initialStop,
      trailingStopPrice: t.trailing ? t.stop : undefined,
    });
    active = null;
    lastExitIndex = index;
  };

  const updateMtmDrawdown = (c: Candle) => {
    if (!active) return;
    const p = prices(c);
    const currentCharges = calculateOptionCharges({ buyPrice: active.entry, sellPrice: p.close, quantity: active.quantity, date: c.timestamp }).totalRoundTripCharges;
    const unrealizedNet = money((p.close - active.entry) * active.quantity - currentCharges);
    const currentEquity = money(capital + unrealizedNet);
    peakEquity = Math.max(peakEquity, currentEquity);
    drawdown = Math.max(drawdown, peakEquity - currentEquity);
    drawdownPct = Math.max(drawdownPct, peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0);
  };

  const protect = (c: Candle, index: number, splitsCutoff = false) => {
    if (!active) return;
    const p = prices(c);
    const closeTime = new Date(Number(new Date(c.timestamp)) + interval).toISOString();

    // 1. Opening gaps (known at candle open - B21)
    if (p.open >= active.target) {
      settle(p.open, iso(c.timestamp), 'TARGET_PROFIT', index);
      return;
    }
    if (p.open <= active.stop) {
      settle(p.open, iso(c.timestamp), active.trailing ? 'TRAILING_STOP_LOSS' : 'STOP_LOSS', index);
      return;
    }

    // 2. Intrabar price extremes
    if (p.low <= active.stop) {
      settle(active.stop, closeTime, active.trailing ? 'TRAILING_STOP_LOSS' : 'STOP_LOSS', index);
      return;
    }
    // B33: If candle spans across cutoff, do not claim target occurring after cutoff boundary
    if (splitsCutoff) {
      settle(p.close, closeTime, 'TIME_CUTOFF', index);
      return;
    }
    if (p.high >= active.target) {
      settle(active.target, closeTime, 'TARGET_PROFIT', index);
      return;
    }
    if (ast.exitRules?.maxHoldingBars && index - active.entryIndex + 1 >= ast.exitRules.maxHoldingBars) {
      settle(p.close, closeTime, 'MAX_HOLDING_BARS', index);
      return;
    }
    if (useTrailing) {
      active.peakClose = Math.max(active.peakClose, p.close);
      const netPeak =
        (active.peakClose - active.entry) * active.quantity -
        calculateOptionCharges({ buyPrice: active.entry, sellPrice: active.peakClose, quantity: active.quantity, date: c.timestamp }).totalRoundTripCharges;
      if (netPeak >= activation) {
        active.trailing = true;
        active.stop = Math.max(active.stop, toTick(active.peakClose - gap / active.quantity));
      }
    }
    updateMtmDrawdown(c);
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const candleMs = Number(new Date(c.timestamp));
    const inTradingWindow = candleMs >= tradeStartMs && candleMs <= tradeEndMs;
    const currentDay = iso(c.timestamp).slice(0, 10);
    if (currentDay !== day) {
      if (active && lastEligibleCandle) {
        settle(
          prices(lastEligibleCandle).close,
          new Date(Number(new Date(lastEligibleCandle.timestamp)) + interval).toISOString(),
          'SESSION_DATA_END',
          i - 1,
        );
      }
      day = currentDay;
      dailyRealizedLoss = 0;
      count = 0;
      signalWaveEntered = false;
    }
    if (!isMarketOpenForTrading(new Date(c.timestamp))) continue;
    lastEligibleCandle = c;

    const time = istTime(c.timestamp);
    const evaluated = i > 0 ? evaluateStrategyAst(ast, i - 1, candles, cache) : { bullishSignal: false, bearishSignal: false, isWarmedUp: false };
    const bullish = evaluated.bullishSignal && !evaluated.bearishSignal;
    const bearish = evaluated.bearishSignal && !evaluated.bullishSignal;
    const hasSignal = bullish || bearish;
    if (!hasSignal) {
      signalWaveEntered = false;
    }
    if (active) {
      const opposite = active.type === 'CE' ? bearish : bullish;
      const closeTimeIst = istTime(Number(new Date(c.timestamp)) + interval);
      if (time >= cutoff || (ast.exitRules?.exitOnOppositeSignal && opposite)) {
        settle(prices(c).open, iso(c.timestamp), time >= cutoff ? 'TIME_CUTOFF' : 'OPPOSITE_SIGNAL', i);
      } else if (time < cutoff && closeTimeIst > cutoff) {
        protect(c, i, true);
      } else {
        protect(c, i, false);
      }
    }
    if (active || lastExitIndex === i) continue;

    // Daily loss budget: cumulative realized loss cannot exceed maxDaily (B12)
    const remainingDailyBudget = Math.max(0, maxDaily - dailyRealizedLoss);

    if (
      !inTradingWindow ||
      !hasSignal ||
      !evaluated.isWarmedUp ||
      time < (strategy.session?.start ?? '09:25') ||
      time > (strategy.session?.lastEntry ?? '14:45') ||
      time >= cutoff ||
      count >= maxTrades ||
      remainingDailyBudget <= 0 ||
      i - lastExitIndex <= (ast.entryRules?.cooldownBars ?? 0) ||
      (ast.entryRules?.allowReentry === false && signalWaveEntered)
    ) {
      continue;
    }

    const type = bullish ? 'CE' : 'PE';
    if (strategy.allowedInstruments && !strategy.allowedInstruments.includes(type === 'CE' ? AllowedOptionType.LONG_CALL : AllowedOptionType.LONG_PUT)) {
      continue;
    }
    if ((ast.contractSelection?.optionSide === 'LONG_CE' && type !== 'CE') || (ast.contractSelection?.optionSide === 'LONG_PE' && type !== 'PE')) {
      continue;
    }

    const premium = toTick(Math.max(25, c.open * 0.0055));
    const entry = toTick(premium + tickSize);
    if (entry < (ast.contractSelection?.minPremium ?? 0) || entry > (ast.contractSelection?.maxPremium ?? Infinity)) {
      continue;
    }

    // Live proposals always size exactly one lot; more lots here would overstate attainable P&L.
    let lots = Math.min(1, Math.floor(Math.min(maxCapital, capital) / (entry * lotSize)));
    let selected: { quantity: number; stop: number; target: number } | undefined;
    while (lots >= 1) {
      const quantity = lots * lotSize;
      const adjusted: StrategyConfig = {
        ...strategy,
        risk: { ...strategy.risk, maxAllInTradeLossInr: Math.min(maxTrade, remainingDailyBudget) } as StrategyConfig['risk'],
      };
      const levels = strategyExitLevels({ strategy: adjusted, entryPrice: entry, quantity, slippageBufferInr: 2 * tickSize * quantity, tickSize });
      if (levels.error || levels.stopPrice === undefined || levels.targetPrice === undefined) {
        lots--;
        continue;
      }

      const targetCharges = calculateOptionCharges({ buyPrice: entry, sellPrice: levels.targetPrice, quantity, date: c.timestamp }).totalRoundTripCharges;
      const netTargetProfit = (levels.targetPrice - entry) * quantity - targetCharges - 2 * tickSize * quantity;
      // Net target viability: target must yield positive net profit (B15)
      if (netTargetProfit <= 0) {
        lots--;
        continue;
      }

      const stopCharges = calculateOptionCharges({ buyPrice: entry, sellPrice: levels.stopPrice, quantity, date: c.timestamp }).totalRoundTripCharges;
      const charges = Math.max(stopCharges, targetCharges);
      const allIn =
        (entry - levels.stopPrice) * quantity +
        stopCharges +
        2 * tickSize * quantity;
      const reserve = entry * quantity + charges + 2 * tickSize * quantity;
      if (
        reserve <= Math.min(maxCapital, capital) &&
        allIn <= Math.min(maxTrade, remainingDailyBudget) &&
        charges <= (strategy.risk?.maxRoundTripCostBudgetInr ?? strategy.maxRoundTripCostBudgetInr ?? Infinity)
      ) {
        selected = { quantity, stop: levels.stopPrice, target: levels.targetPrice };
        break;
      }
      lots--;
    }
    if (!selected) continue;

    active = {
      entryIndex: i,
      entryTime: iso(c.timestamp),
      entryMs: candleMs,
      entry,
      premium,
      spot: c.open,
      quantity: selected.quantity,
      stop: selected.stop,
      initialStop: selected.stop,
      target: selected.target,
      type,
      trailing: false,
      peakClose: entry,
    };
    count++;
    signalWaveEntered = true;
    protect(c, i);
  }

  if (active && lastEligibleCandle) {
    settle(
      prices(lastEligibleCandle).close,
      new Date(Number(new Date(lastEligibleCandle.timestamp)) + interval).toISOString(),
      'DATASET_END',
      candles.indexOf(lastEligibleCandle),
    );
  }

  const totalCharges = money(trades.reduce((sum, t) => sum + t.charges, 0));
  const grossPnl = money(trades.reduce((sum, t) => sum + t.grossPnl, 0));
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const gains = wins.reduce((sum, t) => sum + t.netPnl, 0);
  const loss = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
  // Undefined (null) with no losing trades; returning the summed gains would masquerade as a ratio.
  const profitFactor = loss > 0 ? money(gains / loss) : gains > 0 ? null : 0;

  return {
    ...empty,
    finalCapital: capital,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: trades.length ? money((wins.length / trades.length) * 100) : 0,
    grossPnl,
    totalCharges,
    netPnl: money(grossPnl - totalCharges),
    maxDrawdown: money(drawdown),
    maxDrawdownPct: money(drawdownPct),
    profitFactor,
    trades,
    equityCurve,
  };
}

const UPSTOX_INDEX_MAP: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
};

const YAHOO_INDEX_MAP: Record<string, string> = {
  NIFTY: '%5ENSEI',
  BANKNIFTY: '%5ENSEBANK',
  FINNIFTY: 'NIFTY_FIN_SERVICE.NS',
};

/**
 * Fetches historical underlying candles from named external providers; unavailable data fails closed.
 * Supports Yahoo Finance chart API for NIFTY (^NSEI) and BANKNIFTY (^NSEBANK),
 * or Upstox historical-candle API when authenticated or requested.
 */
export async function fetchRealHistoricalCandles(options: {
  underlying: string;
  timeframe?: string;
  interval?: string;
  days?: number;
  fromDate?: string;
  toDate?: string;
  authToken?: string;
  preferUpstox?: boolean;
}): Promise<{ candles: Candle[]; dataSource: string }> {
  const { underlying, days = 14, fromDate, toDate, authToken, preferUpstox } = options;
  const requestedTf = options.timeframe || options.interval || '5m';
  const upperUnderlying = underlying.toUpperCase();

  if (!(upperUnderlying in UPSTOX_INDEX_MAP)) {
    throw new Error(
      `Unsupported underlying instrument: "${underlying}". Supported underlyings are NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY.`,
    );
  }

  const allowedIntervals = ['1m', '5m', '15m', '30m', '1d'];
  if (!allowedIntervals.includes(requestedTf)) {
    throw new Error(
      `Unsupported timeframe interval: "${requestedTf}". Supported intervals: 1m, 5m, 15m, 30m, 1d.`,
    );
  }
  const interval = requestedTf;

  const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && (!ISO_DATE_REGEX.test(fromDate) || isNaN(Date.parse(fromDate)))) {
    throw new Error(`Invalid fromDate format: "${fromDate}". Expected YYYY-MM-DD.`);
  }
  if (toDate && (!ISO_DATE_REGEX.test(toDate) || isNaN(Date.parse(toDate)))) {
    throw new Error(`Invalid toDate format: "${toDate}". Expected YYYY-MM-DD.`);
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error(`fromDate (${fromDate}) cannot be after toDate (${toDate}).`);
  }

  const rawFrom = fromDate || toDate;
  const rawTo = toDate || fromDate;
  const isCustom = Boolean(rawFrom || rawTo);

  let startMs: number;
  let endMs: number;

  if (isCustom) {
    const f1 = rawFrom!.slice(0, 10);
    const t1 = rawTo!.slice(0, 10);
    const [fromDay, toDay] = f1 <= t1 ? [f1, t1] : [t1, f1];
    startMs = new Date(`${fromDay}T00:00:00+05:30`).getTime();
    endMs = new Date(`${toDay}T23:59:59.999+05:30`).getTime();
  } else {
    endMs = Date.now();
    startMs = endMs - days * 86400000;
  }

  const formatIstDate = (ms: number): string => {
    const ist = new Date(ms + 330 * 60000);
    return ist.toISOString().slice(0, 10);
  };

  // 1. Try Upstox Historical Candle API if token available or preferUpstox specified
  if (authToken || preferUpstox) {
    try {
      const upstoxInstrumentKey = UPSTOX_INDEX_MAP[upperUnderlying]!;
      const upstoxInterval = interval === '1d' ? 'days/1' : `minutes/${strategyTimeframeMinutes(interval)}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (authToken && authToken !== 'public_market_data') {
        headers.Authorization = `Bearer ${authToken}`;
      }

      // Chunk requests in 30-day windows to respect Upstox V3 window limits (B09)
      const chunkMs = 30 * 86400000;
      const chunks: Array<{ start: number; end: number }> = [];
      let cStart = startMs;
      while (cStart < endMs) {
        const cEnd = Math.min(cStart + chunkMs, endMs);
        chunks.push({ start: cStart, end: cEnd });
        cStart = cEnd + 1;
      }

      const candleMap = new Map<string, Candle>();
      for (const chunk of chunks) {
        const toStr = formatIstDate(chunk.end);
        const fromStr = formatIstDate(chunk.start);
        const res = await fetch(
          `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(upstoxInstrumentKey)}/${upstoxInterval}/${toStr}/${fromStr}`,
          { headers, signal: AbortSignal.timeout(10000) },
        );
        if (res.ok) {
          const json = (await res.json()) as any;
          const candlesRaw = json?.data?.candles;
          if (Array.isArray(candlesRaw)) {
            for (const c of candlesRaw) {
              const tMs = new Date(c[0]).getTime();
              if (tMs >= startMs && tMs <= endMs) {
                candleMap.set(c[0], {
                  timestamp: c[0],
                  open: Number(c[1]),
                  high: Number(c[2]),
                  low: Number(c[3]),
                  close: Number(c[4]),
                  volume: Number(c[5] ?? 0),
                });
              }
            }
          }
        }
      }

      if (candleMap.size >= 10) {
        const parsedCandles = Array.from(candleMap.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        return { candles: parsedCandles, dataSource: 'UPSTOX_HISTORICAL_UNDERLYING' };
      }
    } catch {
      // Fall through to Yahoo
    }
  }

  // 2. Fetch from Yahoo Finance Chart Feed (Real NSE Exchange Data) if supported for underlying
  const yahooSymbol = YAHOO_INDEX_MAP[upperUnderlying];
  if (yahooSymbol) {
    try {
      let url = '';
      if (isCustom) {
        const period1 = Math.floor(startMs / 1000);
        const period2 = Math.floor(endMs / 1000);
        url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&period1=${period1}&period2=${period2}`;
      } else {
        const range = days <= 7 ? '7d' : days <= 14 ? '14d' : days <= 30 ? '1mo' : '60d';
        url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
      }

      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const result = data?.chart?.result?.[0];
        const timestamps: number[] = result?.timestamp || [];
        const quote = result?.indicators?.quote?.[0];

        if (timestamps.length > 5 && quote?.open && quote?.close) {
          const candles: Candle[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            const tMs = timestamps[i]! * 1000;
            // Filter strictly within the requested time bounds
            if (tMs < startMs || tMs > endMs) {
              continue;
            }
            const o = quote.open[i];
            const h = quote.high[i];
            const l = quote.low[i];
            const c = quote.close[i];
            const v = quote.volume[i] ?? 0;
            if (o !== null && h !== null && l !== null && c !== null && !isNaN(o) && !isNaN(c)) {
              candles.push({
                timestamp: new Date(tMs).toISOString(),
                open: Number(Number(o).toFixed(2)),
                high: Number(Number(h).toFixed(2)),
                low: Number(Number(l).toFixed(2)),
                close: Number(Number(c).toFixed(2)),
                volume: Number(v),
              });
            }
          }
          if (candles.length >= 10) {
            return { candles, dataSource: 'YAHOO_UNDERLYING_CANDLES' };
          }
        }
      }
    } catch {
      // Network offline fallback
    }
  }

  throw new Error('Historical underlying data is unavailable from the configured providers. No synthetic data was substituted.');
}

/** Explicit deterministic test/demo fixture generator. These are synthetic candles, never fetched market history. */
export function generateHistoricalMarketCandles(underlying:string,days=14,timeframeMinutes=5,fromDate?:string,toDate?:string):Candle[] {
  if (!Number.isInteger(timeframeMinutes) || timeframeMinutes<=0 || timeframeMinutes>375) return [];
  const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  const end=(toDate ?? fromDate ?? today).slice(0,10);
  const start=(fromDate ?? toDate ?? new Date(Date.parse(`${today}T00:00:00Z`)-days*86400000).toISOString().slice(0,10)).slice(0,10);
  const [first,last]=[start,end].sort();
  let seed=2166136261;for(const character of `${underlying}:${first}:${last}:${timeframeMinutes}`) seed=Math.imul(seed^character.charCodeAt(0),16777619);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const candles:Candle[]=[];let price=underlying==='BANKNIFTY'?55256.65:22520.45;
  for(let day=Date.parse(`${first}T03:45:00Z`);day<=Date.parse(`${last}T03:45:00Z`);day+=86400000){
    if(!isMarketOpenForTrading(new Date(day))) continue;
    for(let bar=0;bar<Math.floor(375/timeframeMinutes);bar++){
      const volatility=underlying==='BANKNIFTY'?42:18;
      const open=money(price);price+=Math.sin(bar/18*Math.PI*2)*volatility*0.7+(random()-0.49)*volatility*1.1;
      const close=money(price);candles.push({timestamp:new Date(day+bar*timeframeMinutes*60000).toISOString(),open,close,high:money(Math.max(open,close)+random()*volatility*0.5),low:money(Math.min(open,close)-random()*volatility*0.5),volume:Math.floor(15000+random()*35000)});
    }
  }
  return candles;
}
