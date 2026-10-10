/**
 * Deterministic Financial Indicators
 * Node and browser safe, pure TypeScript.
 */

export interface Candle {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Initial SMA as seed
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i]!;
  }
  let currentEma = sum / period;
  result.push(Number(currentEma.toFixed(4)));

  for (let i = period; i < values.length; i++) {
    currentEma = (values[i]! - currentEma) * multiplier + currentEma;
    result.push(Number(currentEma.toFixed(4)));
  }

  return result;
}

/**
 * Relative Strength Index (RSI - Wilder's smoothed method)
 */
export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length <= period || period <= 0) {
    return [];
  }

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const rsiValues: number[] = [];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  rsiValues.push(Number(rsi.toFixed(2)));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    rsiValues.push(Number(rsi.toFixed(2)));
  }

  return rsiValues;
}

/**
 * Volume Weighted Average Price (VWAP)
 *
 * VWAP is a SESSION indicator — it resets at the start of each trading day.
 * The old implementation accumulated across the entire candle array (bug: produced a
 * meaningless multi-day average). This version resets at each calendar-date boundary
 * using the candle timestamp, matching how NSE/BSE session VWAP is computed.
 *
 * Timestamps are compared by UTC date (market data is stored in UTC; intraday 09:15–15:30
 * IST stays within the same UTC date, so UTC-day boundary is sufficient).
 */
export function calculateVWAP(candles: Candle[]): number[] {
  if (candles.length === 0) return [];

  const vwapValues: number[] = [];
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;
  let lastDate = ''; // tracks YYYY-MM-DD of the last processed candle

  for (const candle of candles) {
    // Determine the calendar date of this candle (UTC date is sufficient for IST intraday)
    const candleDate = new Date(candle.timestamp).toISOString().slice(0, 10);

    // New trading day → reset session accumulators
    if (candleDate !== lastDate) {
      cumulativeTypicalVolume = 0;
      cumulativeVolume = 0;
      lastDate = candleDate;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTypicalVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    const vwap = cumulativeVolume === 0 ? typicalPrice : cumulativeTypicalVolume / cumulativeVolume;
    vwapValues.push(Number(vwap.toFixed(2)));
  }

  return vwapValues;
}



export interface WarmupValidation {
  isWarmedUp: boolean;
  requiredCandles: number;
  availableCandles: number;
  missingCandles: number;
  reason?: string;
}

/**
 * Validates whether sufficient closed historical bars exist to warm up indicators.
 * Prevents cold-start false positives and indicator distortion.
 */
export function validateWarmup(
  candles: Candle[],
  emaPeriod = 20,
  rsiPeriod = 14
): WarmupValidation {
  const requiredCandles = Math.max(emaPeriod, rsiPeriod + 1);
  const availableCandles = candles.length;
  const isWarmedUp = availableCandles >= requiredCandles;
  const missingCandles = Math.max(0, requiredCandles - availableCandles);

  return {
    isWarmedUp,
    requiredCandles,
    availableCandles,
    missingCandles,
    reason: isWarmedUp
      ? undefined
      : `Insufficient warm-up candles: ${availableCandles} available, minimum ${requiredCandles} required (EMA-${emaPeriod}, RSI-${rsiPeriod}).`,
  };
}

/**
 * Simple Moving Average (SMA)
 */
export function calculateSMA(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) {
    return [];
  }
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i]!;
  }
  result.push(Number((sum / period).toFixed(4)));

  for (let i = period; i < values.length; i++) {
    sum += values[i]! - values[i - period]!;
    result.push(Number((sum / period).toFixed(4)));
  }
  return result;
}

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  if (closes.length < period || period <= 0) {
    return { upper: [], middle: [], lower: [] };
  }

  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    middle.push(Number(mean.toFixed(2)));
    upper.push(Number((mean + multiplier * stdDev).toFixed(2)));
    lower.push(Number((mean - multiplier * stdDev).toFixed(2)));
  }

  return { upper, middle, lower };
}

/**
 * Moving Average Convergence Divergence (MACD)
 */
export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }

  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);

  // Align fast EMA with slow EMA (slow EMA starts at slowPeriod - 1)
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEma.length; i++) {
    const fastVal = fastEma[i + offset]!;
    const slowVal = slowEma[i]!;
    macdLine.push(Number((fastVal - slowVal).toFixed(4)));
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const macdAligned = macdLine.slice(signalPeriod - 1);
  const histogram: number[] = [];

  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(Number((macdAligned[i]! - signalLine[i]!).toFixed(4)));
  }

  return {
    macd: macdAligned,
    signal: signalLine,
    histogram,
  };
}

/**
 * Average True Range (ATR)
 */
export function calculateATR(candles: Candle[], period = 14): number[] {
  if (candles.length <= period || period <= 0) {
    return [];
  }

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trs.push(tr);
  }

  const atrValues: number[] = [];
  let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrValues.push(Number(currentAtr.toFixed(2)));

  for (let i = period; i < trs.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trs[i]!) / period;
    atrValues.push(Number(currentAtr.toFixed(2)));
  }

  return atrValues;
}

/**
 * Average Directional Index (ADX)
 */
export function calculateADX(
  candles: Candle[],
  period = 14,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  if (candles.length <= period * 2 || period <= 0) {
    return { adx: [], plusDI: [], minusDI: [] };
  }

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trs.push(tr);

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothedTr = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  const plusDIValues: number[] = [];
  const minusDIValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    smoothedTr = smoothedTr - smoothedTr / period + trs[i]!;
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDMs[i]!;
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDMs[i]!;

    const plusDI = smoothedTr === 0 ? 0 : (smoothedPlusDM / smoothedTr) * 100;
    const minusDI = smoothedTr === 0 ? 0 : (smoothedMinusDM / smoothedTr) * 100;
    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    const dx = diSum === 0 ? 0 : (diDiff / diSum) * 100;

    plusDIValues.push(Number(plusDI.toFixed(2)));
    minusDIValues.push(Number(minusDI.toFixed(2)));
    dxValues.push(dx);
  }

  if (dxValues.length < period) {
    return { adx: [], plusDI: plusDIValues, minusDI: minusDIValues };
  }

  const adxValues: number[] = [];
  let currentAdx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adxValues.push(Number(currentAdx.toFixed(2)));

  for (let i = period; i < dxValues.length; i++) {
    currentAdx = (currentAdx * (period - 1) + dxValues[i]!) / period;
    adxValues.push(Number(currentAdx.toFixed(2)));
  }

  return {
    adx: adxValues,
    plusDI: plusDIValues.slice(plusDIValues.length - adxValues.length),
    minusDI: minusDIValues.slice(minusDIValues.length - adxValues.length),
  };
}

/**
 * Rolling Highest High over N candles
 */
export function calculateHighestHigh(candles: Candle[], period: number): number[] {
  if (candles.length < period || period <= 0) return [];
  const result: number[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j]!.high > max) max = candles[j]!.high;
    }
    result.push(Number(max.toFixed(2)));
  }
  return result;
}

/**
 * Rolling Lowest Low over N candles
 */
export function calculateLowestLow(candles: Candle[], period: number): number[] {
  if (candles.length < period || period <= 0) return [];
  const result: number[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j]!.low < min) min = candles[j]!.low;
    }
    result.push(Number(min.toFixed(2)));
  }
  return result;
}

