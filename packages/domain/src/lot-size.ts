/**
 * NSE F&O Standard Index Lot Sizes and Quantity Validation
 *
 * ⚠️  IMPORTANT: Lot sizes are revised by NSE periodically. These must be kept current.
 *
 * Index reference sizes as of October 2026. Actual contract metadata is authoritative,
 * including contracts from earlier revision periods.
 *
 * Source: https://support.zerodha.com/category/trading-and-markets/trading-faqs/f-otrading/articles/lot-size-for-index-derivatives
 * Verify against broker instrument master before trading.
 */

export const STANDARD_LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  FINNIFTY: 60,
  MIDCPNIFTY: 120,
};

export function getStandardLotSize(symbolOrUnderlying: string): number {
  const upper = symbolOrUnderlying.toUpperCase();
  // Sort by key length descending so BANKNIFTY/FINNIFTY match before NIFTY
  const sortedKeys = Object.entries(STANDARD_LOT_SIZES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, lot] of sortedKeys) {
    if (upper.includes(key)) {
      return lot;
    }
  }
  return 0; // Unknown contract: callers must obtain authoritative instrument metadata.
}

export function isValidLotQuantity(quantity: number, lotSize: number): boolean {
  if (!Number.isInteger(quantity) || !Number.isInteger(lotSize) || quantity <= 0 || lotSize <= 0) return false;
  return quantity % lotSize === 0;
}
