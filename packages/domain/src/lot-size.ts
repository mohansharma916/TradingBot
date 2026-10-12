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

/**
 * Returns historical lot size effective on a given calendar date.
 * If date is omitted or falls in current period, returns standard lot size.
 */
export function getDatedLotSize(symbolOrUnderlying: string, date?: Date | string | number): number {
  if (!date) return getStandardLotSize(symbolOrUnderlying);
  const timeMs = typeof date === 'number' ? date : (typeof date === 'string' ? Date.parse(date) : date.getTime());
  const upper = symbolOrUnderlying.toUpperCase();

  const nov2024Cutoff = Date.parse('2024-11-20T00:00:00Z');
  const apr2024Cutoff = Date.parse('2024-04-26T00:00:00Z');
  const jul2023Cutoff = Date.parse('2023-07-01T00:00:00Z');

  if (upper.includes('BANKNIFTY')) {
    if (timeMs < jul2023Cutoff) return 25;
    if (timeMs < nov2024Cutoff) return 15;
    return 30;
  }

  if (upper.includes('FINNIFTY')) {
    if (timeMs < nov2024Cutoff) return 40;
    return 65;
  }

  if (upper.includes('MIDCPNIFTY')) {
    if (timeMs < nov2024Cutoff) return 75;
    return 120;
  }

  if (upper.includes('NIFTY')) {
    if (timeMs < apr2024Cutoff) return 50;
    if (timeMs < nov2024Cutoff) return 25;
    return 65;
  }

  return getStandardLotSize(symbolOrUnderlying);
}

