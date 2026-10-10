/**
 * NSE F&O Standard Index Lot Sizes and Quantity Validation
 *
 * ⚠️  IMPORTANT: Lot sizes are revised by NSE periodically. These must be kept current.
 *
 * Current values (effective Nov 2024 revision):
 *   - NIFTY:       25  → 75   (changed Nov 2024)
 *   - BANKNIFTY:   15  → 30   (changed Nov 2024)
 *   - FINNIFTY:    25  → 65   (changed Nov 2024)
 *   - MIDCPNIFTY:  50  → 120  (changed Nov 2024)
 *
 * Source: https://support.zerodha.com/category/trading-and-markets/trading-faqs/f-otrading/articles/lot-size-for-index-derivatives
 * Verify against broker instrument master before trading.
 */

export const STANDARD_LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
  MIDCPNIFTY: 50,
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
  return 25; // Safe default for Indian indices
}

export function isValidLotQuantity(quantity: number, lotSize: number): boolean {
  if (quantity <= 0 || lotSize <= 0) return false;
  return quantity % lotSize === 0;
}
