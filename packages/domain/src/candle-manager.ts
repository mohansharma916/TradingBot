import { Candle, validateWarmup, WarmupValidation } from './indicators';

export interface Tick {
  instrumentKey: string;
  price: number;
  volume: number;
  timestamp: number; // epoch ms
}

export interface CandleManagerOptions {
  timeframeMinutes?: number; // default 5 minutes
  maxClosedCandles?: number; // buffer size limit, default 200
  onCandleClose?: (closedCandle: Candle) => void;
}

/**
 * CandleManager
 * Aggregates live market ticks into deterministic time-bucketed candles.
 * 
 * Strict Invariants:
 * 1. Candle-Close Semantics: Signals can ONLY be calculated on confirmed closed candles.
 * 2. Look-Ahead Bias Prevention: Ticks only update their corresponding time-slice.
 * 3. Intra-Bar Protection: In-progress candles are isolated and never exposed as completed.
 */
export class CandleManager {
  private readonly intervalMs: number;
  private readonly maxClosedCandles: number;
  private readonly onCandleClose?: (closedCandle: Candle) => void;

  private formingCandle: Candle | null = null;
  private currentBucketStart: number | null = null;
  private closedCandles: Candle[] = [];

  constructor(options: CandleManagerOptions = {}) {
    const minutes = options.timeframeMinutes ?? 5;
    this.intervalMs = minutes * 60 * 1000;
    this.maxClosedCandles = options.maxClosedCandles ?? 200;
    this.onCandleClose = options.onCandleClose;
  }

  /**
   * Process an incoming tick.
   * If the tick crosses into a new time interval, the currently forming candle is closed.
   */
  public processTick(tick: Tick): Candle | null {
    if (tick.price <= 0 || tick.timestamp <= 0) {
      return null;
    }

    const bucketStart = Math.floor(tick.timestamp / this.intervalMs) * this.intervalMs;
    let newlyClosedCandle: Candle | null = null;

    if (this.currentBucketStart === null) {
      // First tick ever
      this.currentBucketStart = bucketStart;
      this.formingCandle = {
        timestamp: new Date(bucketStart).toISOString(),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      };
      return null;
    }

    if (bucketStart > this.currentBucketStart) {
      // Previous candle has completed its time window!
      if (this.formingCandle) {
        newlyClosedCandle = { ...this.formingCandle };
        this.addClosedCandle(newlyClosedCandle);

        if (this.onCandleClose) {
          this.onCandleClose(newlyClosedCandle);
        }
      }

      // Initialize the new candle bucket
      this.currentBucketStart = bucketStart;
      this.formingCandle = {
        timestamp: new Date(bucketStart).toISOString(),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      };
    } else if (bucketStart === this.currentBucketStart) {
      // Continuing the existing candle
      if (this.formingCandle) {
        this.formingCandle.high = Math.max(this.formingCandle.high, tick.price);
        this.formingCandle.low = Math.min(this.formingCandle.low, tick.price);
        this.formingCandle.close = tick.price;
        this.formingCandle.volume += tick.volume;
      }
    } else {
      // Out-of-order tick from the past: Discard to prevent look-ahead corruption
      // In high-frequency trading, ticks older than current bucket are rejected
      return null;
    }

    return newlyClosedCandle;
  }

  /**
   * Directly seed historical closed candles (e.g. from historical data / warm-up API)
   */
  public seedClosedCandles(candles: Candle[]): void {
    this.closedCandles = [...candles].slice(-this.maxClosedCandles);
  }

  /**
   * Explicitly closes current forming candle (e.g. on market close session end)
   */
  public forceCloseCurrentCandle(): Candle | null {
    if (!this.formingCandle) return null;
    const closed = { ...this.formingCandle };
    this.addClosedCandle(closed);
    this.formingCandle = null;
    this.currentBucketStart = null;
    if (this.onCandleClose) {
      this.onCandleClose(closed);
    }
    return closed;
  }

  /**
   * Returns ONLY confirmed closed candles.
   * Crucial invariant: NEVER contains intra-bar forming candles!
   */
  public getClosedCandles(): Candle[] {
    return [...this.closedCandles];
  }

  /**
   * Returns the in-progress candle for live visual display only.
   */
  public getFormingCandle(): Candle | null {
    return this.formingCandle ? { ...this.formingCandle } : null;
  }

  /**
   * Validates if enough closed candles are available for indicators
   */
  public checkWarmup(emaPeriod = 20, rsiPeriod = 14): WarmupValidation {
    return validateWarmup(this.closedCandles, emaPeriod, rsiPeriod);
  }

  private addClosedCandle(candle: Candle): void {
    this.closedCandles.push(candle);
    if (this.closedCandles.length > this.maxClosedCandles) {
      this.closedCandles.shift();
    }
  }
}
