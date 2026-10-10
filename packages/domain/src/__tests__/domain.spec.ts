import { describe, it, expect } from 'vitest';
import {
  calculateOptionCharges,
  getStandardLotSize,
  isValidLotQuantity,
  evaluateTradeRisk,
  calculateEMA,
  calculateRSI,
  calculateVWAP,
} from '../index.ts';

describe('Domain Package', () => {
  describe('calculateOptionCharges', () => {
    it('computes realistic round-trip option charges for NIFTY lot', () => {
      const breakdown = calculateOptionCharges({
        buyPrice: 120,
        sellPrice: 135,
        quantity: 25, // 1 lot of NIFTY
      });

      expect(breakdown.brokerage).toBe(40.0); // 20 + 20
      expect(breakdown.stt).toBeGreaterThan(3); // STT on sell turnover
      expect(breakdown.gst).toBeGreaterThan(7); // 18% GST
      expect(breakdown.totalRoundTripCharges).toBeGreaterThan(50);
      expect(breakdown.totalRoundTripCharges).toBeLessThan(75);
    });
  });

  describe('lot-size', () => {
    it('identifies NIFTY and BANKNIFTY lot sizes', () => {
      expect(getStandardLotSize('NIFTY26OCT25000CE')).toBe(25);
      expect(getStandardLotSize('BANKNIFTY26OCT52000PE')).toBe(15);
      expect(isValidLotQuantity(50, 25)).toBe(true);
      expect(isValidLotQuantity(30, 25)).toBe(false);
    });
  });

  describe('evaluateTradeRisk', () => {
    const baseInput = {
      entryPrice: 100,
      stopPrice: 90,
      targetPrice: 120,
      quantity: 25,
      lotSize: 25,
      availableCash: 10000,
      maxCapitalInr: 10000,
      maxAllInTradeLossInr: 500,
      dailyLossCapInr: 1500,
      realizedNetDailyLossInr: 0,
      openRiskReservationsInr: 0,
      currentOpenPositions: 0,
      maxOpenPositions: 1,
      killSwitchActive: false,
    };

    it('approves compliant long option trade', () => {
      const result = evaluateTradeRisk(baseInput);
      expect(result.allowed).toBe(true);
      expect(result.grossLossAtStop).toBe(250); // (100 - 90) * 25
      expect(result.allInRisk).toBeLessThan(500); // 250 + charges + slippage
      expect(result.reasons).toHaveLength(0);
    });

    it('rejects trade when all-in risk exceeds per-trade cap', () => {
      const highRiskInput = {
        ...baseInput,
        stopPrice: 70, // 30 pt loss * 25 = 750 gross loss + fees
      };
      const result = evaluateTradeRisk(highRiskInput);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('All-in risk'))).toBe(true);
    });

    it('rejects trade when kill switch is active', () => {
      const result = evaluateTradeRisk({
        ...baseInput,
        killSwitchActive: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Kill switch is ACTIVE'))).toBe(true);
    });

    it('rejects trade if open position limit is reached', () => {
      const result = evaluateTradeRisk({
        ...baseInput,
        currentOpenPositions: 1,
        maxOpenPositions: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Maximum open positions limit reached'))).toBe(true);
    });
  });

  describe('indicators', () => {
    it('calculates EMA sequence correctly', () => {
      const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const ema = calculateEMA(data, 5);
      expect(ema.length).toBe(7);
      expect(ema[ema.length - 1]).toBeGreaterThan(16);
    });

    it('calculates RSI values within [0, 100]', () => {
      const closes = [
        100, 102, 104, 103, 105, 107, 106, 108, 110, 112, 111, 113, 115, 117, 116, 118, 120,
      ];
      const rsi = calculateRSI(closes, 14);
      expect(rsi.length).toBeGreaterThan(0);
      for (const val of rsi) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('calculates VWAP correctly', () => {
      const candles = [
        { timestamp: '1', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
        { timestamp: '2', open: 100, high: 110, low: 100, close: 105, volume: 2000 },
      ];
      const vwap = calculateVWAP(candles);
      expect(vwap.length).toBe(2);
      expect(vwap[0]).toBe(100);
      expect(vwap[1]).toBeGreaterThan(100);
    });
  });
});
