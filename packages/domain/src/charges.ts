/**
 * Indian F&O Options Charges & Brokerage Calculator
 * Computes exact estimates for round-trip transactions including:
 * - Brokerage (Upstox standard ₹20 per executed order leg)
 * - STT (Securities Transaction Tax: 0.15% on sell side option premium — revised 1 Apr 2026)
 * - Exchange Transaction Charges (NSE F&O: 0.03553% on option turnover — revised 1 Mar 2026)
 * - SEBI Turnover Fees (₹10 per crore = 0.0001%)
 * - Stamp Duty (0.003% on buy turnover)
 * - GST (18% on Brokerage + Exchange charges + SEBI charges)
 *
 * ⚠️  Charge rates last verified: October 2026
 * Source: https://upstox.com/brokerage-charges/
 *   STT: 0.15% on sell premium (was 0.1% before 1 Apr 2026)
 *   NSE options transaction fee: 0.03553% (was 0.0505% before 1 Mar 2026)
 */

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiCharges: number;
  stampDuty: number;
  gst: number;
  totalRoundTripCharges: number;
}

export function calculateOptionCharges(params: {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
}): ChargeBreakdown {
  const { buyPrice, sellPrice, quantity } = params;

  const buyTurnover = buyPrice * quantity;
  const sellTurnover = sellPrice * quantity;
  const totalTurnover = buyTurnover + sellTurnover;

  // Brokerage: ₹20 per leg (Buy + Sell)
  const brokerage = 20.0 + 20.0;

  // STT: 0.15% on sell-side option premium turnover (revised 1 April 2026 — was 0.1%)
  const stt = Number((sellTurnover * 0.0015).toFixed(2));

  // NSE Exchange Charges: 0.03553% on option premium turnover (revised 1 March 2026 — was 0.0505%)
  const exchangeCharges = Number((totalTurnover * 0.0003553).toFixed(2));

  // SEBI turnover charges: ₹10 per crore (0.0001% of turnover)
  const sebiCharges = Number((totalTurnover * 0.000001).toFixed(2));

  // Stamp Duty: 0.003% on buy-side turnover
  const stampDuty = Number((buyTurnover * 0.00003).toFixed(2));

  // GST: 18% on (Brokerage + Exchange Charges + SEBI Charges)
  const gstBase = brokerage + exchangeCharges + sebiCharges;
  const gst = Number((gstBase * 0.18).toFixed(2));

  const totalRoundTripCharges = Number(
    (brokerage + stt + exchangeCharges + sebiCharges + stampDuty + gst).toFixed(2),
  );

  return {
    brokerage,
    stt,
    exchangeCharges,
    sebiCharges,
    stampDuty,
    gst,
    totalRoundTripCharges,
  };
}
