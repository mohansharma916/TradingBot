/**
 * NSE F&O Standard Index Lot Sizes and Quantity Validation
 */

export const STANDARD_LOT_SIZES: Record<string, number> = {
  NIFTY: 25, // Updated NSE standard lot size
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
