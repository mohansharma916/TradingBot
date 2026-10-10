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
 */
export function calculateVWAP(candles: Candle[]): number[] {
  if (candles.length === 0) return [];

  const vwapValues: number[] = [];
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
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
