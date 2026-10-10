import { TradingPlatformClient } from '@trading-bot/client-sdk';

/**
 * Universal singleton TradingPlatformClient connecting to the live NestJS API.
 * Uses EXPO_PUBLIC_API_URL or defaults to localhost:4000/api/v1.
 */
export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) ||
  'http://localhost:4000/api/v1';

export const apiClient = new TradingPlatformClient({
  baseUrl: API_BASE_URL,
  fetchFn: typeof window !== 'undefined' ? window.fetch.bind(window) : undefined,
});
