import { formatErrorMessage } from '@trading-bot/client-sdk';
import { apiClient } from '../../services/api';

export type Underlying = 'NIFTY' | 'BANKNIFTY';

export const UNDERLYINGS: Underlying[] = ['NIFTY', 'BANKNIFTY'];
export const SPOT_KEYS: Record<Underlying, string> = { NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank' };

export interface ChainSnapshot {
  expiry: string;
  rows: any[] | null;
  spotPrice: number | null;
  expiries: string[] | null;
  lotSize: number;
}

export interface MarketCache {
  selectedUnderlying: Underlying;
  chains: Record<Underlying, ChainSnapshot>;
  feedLatencyMs: number | null;
  isFeedStale: boolean;
  isLiveConnected: boolean;
  dataSource: string;
  watchlistQuotes: Record<string, any>;
  connectionError: string | null;
}

const STORAGE_KEY = 'TRADING_MARKET_CACHE_V1';

const emptyChain = (): ChainSnapshot => ({ expiry: '', rows: null, spotPrice: null, expiries: null, lotSize: 0 });

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Restores the last session's prices so the very first paint has numbers. Everything restored is
 * flagged stale/disconnected: it is display-only until the first fresh response replaces it.
 */
const hydrate = (): MarketCache => {
  const base: MarketCache = {
    selectedUnderlying: 'NIFTY',
    chains: { NIFTY: emptyChain(), BANKNIFTY: emptyChain() },
    feedLatencyMs: null,
    isFeedStale: true,
    isLiveConnected: false,
    dataSource: 'UNAVAILABLE',
    watchlistQuotes: {},
    connectionError: null,
  };
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<MarketCache>;
    const watchlistQuotes: Record<string, any> = {};
    for (const [key, quote] of Object.entries(saved.watchlistQuotes || {})) watchlistQuotes[key] = { ...quote, isStale: true };
    return {
      ...base,
      selectedUnderlying: saved.selectedUnderlying === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY',
      chains: {
        NIFTY: { ...emptyChain(), ...saved.chains?.NIFTY },
        BANKNIFTY: { ...emptyChain(), ...saved.chains?.BANKNIFTY },
      },
      dataSource: saved.dataSource || base.dataSource,
      watchlistQuotes,
    };
  } catch {
    return base;
  }
};

export const marketCache: MarketCache = hydrate();

const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Quote ticks can arrive many times a second; persist at most every 2s. */
const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(marketCache));
    } catch {}
  }, 2000);
};

export const updateMarketCache = (patch: Partial<MarketCache>, notify = false) => {
  Object.assign(marketCache, patch);
  schedulePersist();
  if (notify) for (const listener of listeners) listener();
};

export const subscribeMarketCache = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const inFlight = new Map<string, Promise<void>>();
let pendingRequests = 0;

/** True while a fetch runs and nothing has been loaded yet for that slot: show "Loading…", not "Unavailable". */
export const isMarketDataLoading = () => pendingRequests > 0;

// Takes a thunk so a synchronous throw becomes a rejection instead of crashing the caller (e.g. the layout prefetch).
const track = <T>(request: () => Promise<T>): Promise<T> => {
  pendingRequests += 1;
  return Promise.resolve().then(request).finally(() => {
    pendingRequests -= 1;
    if (pendingRequests === 0) for (const listener of listeners) listener();
  });
};

const formatError = (failure: unknown) => formatErrorMessage(failure) || 'Market data unavailable.';

/**
 * Fetches index quotes, feed health and the given option chains. Each response is applied as soon as it
 * lands, so a slow broker option chain never holds back the index cards. Concurrent calls for the same
 * underlyings share one request.
 */
export const fetchMarketData = (underlyings: Underlying[] = UNDERLYINGS): Promise<void> => {
  const key = underlyings.join(',');
  const existing = inFlight.get(key);
  if (existing) return existing;
  const tasks: Promise<unknown>[] = [
    track(() => apiClient.getWatchlist()).then((watchlist) => {
      if (!Array.isArray(watchlist)) return;
      // Merge rather than replace, so a quote missing from one response never blanks a card.
      const watchlistQuotes = { ...marketCache.watchlistQuotes };
      for (const q of watchlist) if (q?.instrumentKey) watchlistQuotes[q.instrumentKey] = q;
      updateMarketCache({ watchlistQuotes }, true);
    }),
    track(() => apiClient.getFeedHealth()).then((diag) => {
      updateMarketCache({
        dataSource: diag.provenance || 'UNAVAILABLE',
        feedLatencyMs: diag.lastTickReceivedAt ? diag.feedLatencyMs : null,
        isFeedStale: diag.provenance !== 'LIVE' || diag.staleCount > 0,
      }, true);
    }),
    ...underlyings.map((underlying) => {
      const requestedExpiry = marketCache.chains[underlying].expiry;
      return track(() => apiClient.getOptionChain(underlying, requestedExpiry)).then((chain) => {
        const current = marketCache.chains[underlying];
        // The user picked another expiry while this was in flight; its own fetch will fill the chain.
        if (!chain || current.expiry !== requestedExpiry) return;
        updateMarketCache({
          isLiveConnected: true,
          connectionError: null,
          chains: {
            ...marketCache.chains,
            [underlying]: {
              expiry: current.expiry || chain.expiryDate || '',
              rows: chain.strikes as any,
              spotPrice: chain.spotPrice,
              expiries: chain.availableExpiries || [],
              lotSize: chain.lotSize,
            },
          },
        }, true);
      });
    }),
  ];
  const run = Promise.allSettled(tasks).then((results) => {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) updateMarketCache({ isLiveConnected: false, dataSource: 'UNAVAILABLE', connectionError: formatError(failure.reason) }, true);
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
};

/** Called right after sign-in so the first visit to Markets already has both indices and chains. */
export const prefetchMarketData = () => fetchMarketData(UNDERLYINGS);

/** Applies a WebSocket quotes.snapshot payload to index cards and every cached option chain. */
export const applyQuoteTicks = (quotes: any[]) => {
  const byKey = new Map<string, any>();
  for (const q of quotes) if (q?.instrumentKey) byKey.set(q.instrumentKey, q);
  if (!byKey.size) return;
  const watchlistQuotes = { ...marketCache.watchlistQuotes };
  for (const [key, q] of byKey) watchlistQuotes[key] = q;
  const chains = { ...marketCache.chains };
  for (const underlying of UNDERLYINGS) {
    const current = chains[underlying];
    const spot = byKey.get(SPOT_KEYS[underlying]);
    const rows = mergeQuotesIntoRows(current.rows, byKey);
    const spotPrice = spot?.lastPrice > 0 ? spot.lastPrice : current.spotPrice;
    if (rows !== current.rows || spotPrice !== current.spotPrice) chains[underlying] = { ...current, rows, spotPrice };
  }
  updateMarketCache({ watchlistQuotes, chains }, true);
};

const mergeQuotesIntoRows = (rows: any[] | null, byKey: Map<string, any>): any[] | null => {
  if (!rows) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const callMatch = row.call?.instrumentKey ? byKey.get(row.call.instrumentKey) : undefined;
    const putMatch = row.put?.instrumentKey ? byKey.get(row.put.instrumentKey) : undefined;
    const call = row.call && callMatch?.lastPrice > 0 ? { ...row.call, ...callMatch } : row.call;
    const put = row.put && putMatch?.lastPrice > 0 ? { ...row.put, ...putMatch } : row.put;
    if (call === row.call && put === row.put) return row;
    changed = true;
    return { ...row, call, put };
  });
  return changed ? next : rows;
};
