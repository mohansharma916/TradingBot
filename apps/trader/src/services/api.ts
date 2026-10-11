import { TradingPlatformClient } from '@trading-bot/client-sdk';
import { resolveApiBaseUrl } from './api-url';

/**
 * Universal singleton TradingPlatformClient connecting to the live NestJS API.
 * Uses the public Expo API URL or the local development API.
 */
// Expo only inlines public variables accessed with direct dot notation.
export const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);

export const apiClient = new TradingPlatformClient({
  baseUrl: API_BASE_URL,
  fetchFn: typeof window !== 'undefined' ? window.fetch.bind(window) : undefined,
});
