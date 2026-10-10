import {
  BacktestRequest,
  BacktestResult,
  BacktestTradeRecord,
  StrategyConfig,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle, calculateEMA, calculateRSI } from './indicators';
import { getStandardLotSize } from './lot-size';

export interface BacktestOptions {
  strategy: StrategyConfig;
  candles: Candle[];
  request?: Partial<BacktestRequest>;
}

/**
 * Deterministic Strategy Backtesting Engine
 * 
 * Strict Invariants:
 * 1. Zero Look-Ahead Bias: Indicator calculations strictly evaluate closed bars prior to bar i.
 * 2. Realistic Statutory Friction: Every trade accounts for exact SEBI, NSE, STT, and GST levies.
 * 3. Bounded Intra-bar Execution: Option premium behavior modeled via delta-adjusted index movement.
 * 4. Account Risk Invariants: Stop loss, profit target, and daily trade caps enforced per bar.
 */
function toIso(t?: string | number): string {
  if (!t) return new Date().toISOString();
  return typeof t === 'number' ? new Date(t).toISOString() : new Date(t).toISOString();
}

export function runStrategyBacktest(options: BacktestOptions): BacktestResult {
  const { strategy, candles, request } = options;
  const initialCapital = request?.initialCapital ?? strategy.risk?.maxCapitalInr ?? 10000;
  const lotSize = getStandardLotSize(strategy.underlying || 'NIFTY');
  const daysRequested = request?.days ?? 14;

  const fromDate = toIso(candles[0]?.timestamp ?? new Date(Date.now() - daysRequested * 86400000).toISOString());
  const toDate = toIso(candles[candles.length - 1]?.timestamp ?? new Date().toISOString());

  const emptyResult: BacktestResult = {
    strategyId: strategy.id,
    strategyName: strategy.name,
    version: strategy.version,
    periodDays: daysRequested,
    fromDate,
    toDate,
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
    trades: [],
  };

  if (!candles || candles.length < 25) {
    return emptyResult;
  }

  // Sort candles chronologically
  const sortedCandles = [...candles].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let runningCapital = initialCapital;
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  const trades: BacktestTradeRecord[] = [];

  let activeTrade: {
    id: string;
    entryTime: string;
    entryPrice: number;
    spotAtEntry: number;
    quantity: number;
    stopPrice: number;
    targetPrice: number;
    symbol: string;
  } | null = null;

  let dailyTradesCount = 0;
  let lastDayString = '';

  const emaPeriod = strategy.entry?.emaPeriod ?? 20;
  const rsiPeriod = strategy.entry?.rsiPeriod ?? 14;
  const rsiThreshold = strategy.entry?.rsiThreshold ?? 55;
  const maxTradesPerDay = strategy.risk?.maxTradesPerDay ?? 3;
  const maxTradeLossInr = strategy.risk?.maxAllInTradeLossInr ?? 200;
  const targetProfitInr = strategy.risk?.targetNetProfitInr ?? 300;
  const sessionStart = strategy.session?.start ?? '09:25';
  const sessionLastEntry = strategy.session?.lastEntry ?? '14:45';
  const marketCutoff = strategy.exit?.marketCutoff ?? '15:10';

  // Iterate candle-by-candle starting after warmup
  for (let i = Math.max(emaPeriod, rsiPeriod) + 2; i < sortedCandles.length; i++) {
    const curr = sortedCandles[i]!;
    const candleIso = toIso(curr.timestamp);
    const candleDateStr = candleIso.slice(0, 10);

    // New trading day rollover
    if (candleDateStr !== lastDayString) {
      dailyTradesCount = 0;
      lastDayString = candleDateStr;
    }

    // Extract time in HH:MM IST
    const candleDate = new Date(candleIso);
    const timeHours = candleDate.getUTCHours();
    const timeMins = candleDate.getUTCMinutes();
    // Convert to IST (UTC+5:30)
    let istTotalMinutes = timeHours * 60 + timeMins + 330;
    if (istTotalMinutes >= 1440) istTotalMinutes -= 1440;
    const istHoursStr = String(Math.floor(istTotalMinutes / 60)).padStart(2, '0');
    const istMinsStr = String(istTotalMinutes % 60).padStart(2, '0');
    const currentTimeIst = `${istHoursStr}:${istMinsStr}`;

    // 1. Evaluate Active Position Exit
    if (activeTrade !== null) {
      const spotDelta = curr.close - activeTrade.spotAtEntry;
      const spotHighDelta = curr.high - activeTrade.spotAtEntry;
      const spotLowDelta = curr.low - activeTrade.spotAtEntry;

      // Delta 0.5 for ATM option
      const approxHighOption = Math.max(1, activeTrade.entryPrice + spotHighDelta * 0.5);
      const approxLowOption = Math.max(1, activeTrade.entryPrice + spotLowDelta * 0.5);
      const approxCloseOption = Math.max(1, activeTrade.entryPrice + spotDelta * 0.5);

      let exitPrice: number | null = null;
      let exitReason: string | null = null;

      // Target Profit Check
      if (approxHighOption >= activeTrade.targetPrice) {
        exitPrice = activeTrade.targetPrice;
        exitReason = 'TARGET_PROFIT';
      }
      // Stop Loss Check
      else if (approxLowOption <= activeTrade.stopPrice) {
        exitPrice = activeTrade.stopPrice;
        exitReason = 'STOP_LOSS';
      }
      // Session Cutoff Check (15:10 IST)
      else if (currentTimeIst >= marketCutoff) {
        exitPrice = Number(approxCloseOption.toFixed(2));
        exitReason = 'TIME_CUTOFF';
      }

      if (exitPrice !== null && exitReason !== null) {
        const grossPnl = Number(((exitPrice - activeTrade.entryPrice) * activeTrade.quantity).toFixed(2));
        const chargesBreakdown = calculateOptionCharges({
          buyPrice: activeTrade.entryPrice,
          sellPrice: exitPrice,
          quantity: activeTrade.quantity,
        });
        const charges = Number(chargesBreakdown.totalRoundTripCharges.toFixed(2));
        const netPnl = Number((grossPnl - charges).toFixed(2));

        runningCapital += netPnl;
        if (runningCapital > peakCapital) peakCapital = runningCapital;
        const currentDrawdown = peakCapital - runningCapital;
        if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

        trades.push({
          id: `bt_${trades.length + 1}`,
          entryTime: activeTrade.entryTime,
          exitTime: toIso(curr.timestamp),
          symbol: activeTrade.symbol,
          side: 'BUY',
          entryPrice: Number(activeTrade.entryPrice.toFixed(2)),
          exitPrice: Number(exitPrice.toFixed(2)),
          quantity: activeTrade.quantity,
          grossPnl,
          charges,
          netPnl,
          exitReason,
        });

        activeTrade = null;
      }
    }

    // 2. Evaluate Entry Signal (Only if flat and within daily session hours)
    if (activeTrade === null) {
      if (dailyTradesCount >= maxTradesPerDay) continue;
      if (currentTimeIst < sessionStart || currentTimeIst > sessionLastEntry) continue;

      // Strictly evaluate confirmed closed candles up to bar i - 1 (no look-ahead)
      const historicalCloses = sortedCandles.slice(0, i).map((c) => c.close);
      const emaValues = calculateEMA(historicalCloses, emaPeriod);
      const rsiValues = calculateRSI(historicalCloses, rsiPeriod);

      const emaCurr = emaValues[emaValues.length - 1];
      const emaPrev = emaValues[emaValues.length - 2];
      const rsiCurr = rsiValues[rsiValues.length - 1];
      const rsiPrev = rsiValues[rsiValues.length - 2];

      const prevClose = historicalCloses[historicalCloses.length - 1];
      const prev2Close = historicalCloses[historicalCloses.length - 2];

      if (
        emaCurr !== undefined &&
        emaPrev !== undefined &&
        rsiCurr !== undefined &&
        prevClose !== undefined &&
        prev2Close !== undefined
      ) {
        // Bullish transition: Price crossed above EMA20 or RSI broke above threshold while price is above EMA
        const isEmaBullCross = prev2Close <= emaPrev && prevClose > emaCurr;
        const isRsiBreakout = prevClose > emaCurr && rsiPrev !== undefined && rsiPrev < rsiThreshold && rsiCurr >= rsiThreshold;
        const isBullishSignal = (isEmaBullCross || isRsiBreakout) && rsiCurr >= rsiThreshold;

        if (isBullishSignal) {
          // Model realistic ATM Call Option entry
          // Option premium ~ 0.55% of underlying spot price
          const estimatedPremium = Math.max(25, Number((curr.open * 0.0055).toFixed(2)));
          const maxTradeCapital = Math.min(strategy.risk?.maxCapitalInr ?? 10000, runningCapital);

          // Standard lot sizing (e.g. 25 units for NIFTY, 15 for BANKNIFTY)
          const costPerLot = estimatedPremium * lotSize;
          const allowedLots = Math.max(1, Math.floor(maxTradeCapital / costPerLot));
          const totalUnits = allowedLots * lotSize;

          const pointsStop = Math.max(3, maxTradeLossInr / totalUnits);
          const pointsTarget = Math.max(5, targetProfitInr / totalUnits);

          const stopPrice = Math.max(1, Number((estimatedPremium - pointsStop).toFixed(2)));
          const targetPrice = Number((estimatedPremium + pointsTarget).toFixed(2));

          activeTrade = {
            id: `trade_${Date.now()}_${i}`,
            entryTime: toIso(curr.timestamp),
            entryPrice: estimatedPremium,
            spotAtEntry: curr.open,
            quantity: totalUnits,
            stopPrice,
            targetPrice,
            symbol: `${strategy.underlying || 'NIFTY'} ATM CE`,
          };

          dailyTradesCount++;
        }
      }
    }
  }

  // Calculate final performance metrics
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.netPnl > 0).length;
  const losingTrades = trades.filter((t) => t.netPnl <= 0).length;
  const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;
  const grossPnl = Number(trades.reduce((sum, t) => sum + t.grossPnl, 0).toFixed(2));
  const totalCharges = Number(trades.reduce((sum, t) => sum + t.charges, 0).toFixed(2));
  const netPnl = Number((grossPnl - totalCharges).toFixed(2));
  const finalCapital = Number((initialCapital + netPnl).toFixed(2));
  const maxDrawdownFormatted = Number(maxDrawdown.toFixed(2));
  const maxDrawdownPct = peakCapital > 0 ? Number(((maxDrawdown / peakCapital) * 100).toFixed(1)) : 0;

  const totalGains = trades.filter((t) => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const totalLosses = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = totalLosses > 0 ? Number((totalGains / totalLosses).toFixed(2)) : (totalGains > 0 ? 9.99 : 0);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    version: strategy.version,
    periodDays: daysRequested,
    fromDate,
    toDate,
    initialCapital,
    finalCapital,
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct,
    grossPnl,
    totalCharges,
    netPnl,
    maxDrawdown: maxDrawdownFormatted,
    maxDrawdownPct,
    profitFactor,
    trades,
  };
}

/**
 * Generates realistic historical 5-minute market candles for backtesting
 * strictly adhering to Indian Exchange hours (09:15 to 15:30 IST).
 */
export function generateHistoricalMarketCandles(
  underlying: string,
  days = 14,
  timeframeMinutes = 5,
): Candle[] {
  const candles: Candle[] = [];
  const basePrice = underlying === 'BANKNIFTY' ? 52000.0 : 25000.0;
  let runningPrice = basePrice;

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let d = days; d >= 0; d--) {
    const dayDate = new Date(now.getTime() - d * dayMs);
    const dayOfWeek = dayDate.getUTCDay();

    // Skip weekends (Saturday: 6, Sunday: 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const year = dayDate.getUTCFullYear();
    const month = String(dayDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dayDate.getUTCDate()).padStart(2, '0');

    // Indian market trading session: 09:15 to 15:30 IST (03:45 to 10:00 UTC)
    // 75 bars of 5 minutes each
    const sessionStartUtcMs = Date.parse(`${year}-${month}-${day}T03:45:00.000Z`);
    const totalBars = Math.floor(375 / timeframeMinutes);

    for (let bar = 0; bar < totalBars; bar++) {
      const barTimestamp = new Date(sessionStartUtcMs + bar * timeframeMinutes * 60 * 1000).toISOString();
      const volatility = underlying === 'BANKNIFTY' ? 42.0 : 18.0;

      // Realistic intraday market wave momentum (morning, mid-day, afternoon waves)
      const cyclicDrift = Math.sin((bar / 18) * Math.PI * 2) * (volatility * 0.7);
      const randomNoise = (Math.random() - 0.49) * volatility * 1.1;
      const delta = cyclicDrift + randomNoise;

      const open = Number(runningPrice.toFixed(2));
      runningPrice += delta;
      const close = Number(runningPrice.toFixed(2));
      const high = Number((Math.max(open, close) + Math.random() * (volatility * 0.5)).toFixed(2));
      const low = Number((Math.min(open, close) - Math.random() * (volatility * 0.5)).toFixed(2));
      const volume = Math.floor(15000 + Math.random() * 35000);

      candles.push({
        timestamp: barTimestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }
  }

  return candles;
}
