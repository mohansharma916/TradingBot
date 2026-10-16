import { useState, useEffect, useReducer } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';
import { isMarketOpenForTrading } from '@trading-bot/domain';
import { apiClient } from '../src/services/api';
import { formatErrorMessage } from '@trading-bot/client-sdk';
import {
  Underlying, SPOT_KEYS, marketCache, updateMarketCache, subscribeMarketCache, fetchMarketData, applyQuoteTicks, isMarketDataLoading,
} from '../src/features/markets/market-cache';

interface OptionStrikeRow {
  strikePrice: number;
  call?: {
    instrumentKey: string;
    symbol: string;
    lastPrice: number;
    bidPrice: number;
    askPrice: number;
    volume: number;
    openInterest: number;
    netChangePct: number;
    isStale: boolean;
    provenance?: string;
  };
  put?: {
    instrumentKey: string;
    symbol: string;
    lastPrice: number;
    bidPrice: number;
    askPrice: number;
    volume: number;
    openInterest: number;
    netChangePct: number;
    isStale: boolean;
    provenance?: string;
  };
}

export default function MarketsScreen() {
  // Module-level store: survives tab switches and is pre-warmed at sign-in, so the first paint has data.
  const [, rerender] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => subscribeMarketCache(rerender), []);
  const { selectedUnderlying, chains, feedLatencyMs, isFeedStale, isLiveConnected, dataSource, watchlistQuotes, connectionError } = marketCache;
  const isLoading = isMarketDataLoading();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(() => isMarketOpenForTrading());
  const [snapshotTrigger, setSnapshotTrigger] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const chain = chains[selectedUnderlying];
  const selectedExpiry = chain.expiry;
  const liveOptionRows = chain.rows as OptionStrikeRow[] | null;
  const liveSpotPrice = chain.spotPrice;
  const liveExpiries = chain.expiries;
  const liveLotSize = chain.lotSize;

  const setSelectedUnderlying = (underlying: Underlying) => updateMarketCache({ selectedUnderlying: underlying }, true);
  const setSelectedExpiry = (expiry: string) =>
    updateMarketCache({ chains: { ...marketCache.chains, [selectedUnderlying]: { ...marketCache.chains[selectedUnderlying], expiry } } }, true);
  const setConnectionError = (message: string | null) => updateMarketCache({ connectionError: message }, true);

  // Real-time WebSocket streaming: one connection for the screen's lifetime, updates both indices' chains.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true;

    try {
      const token = typeof window !== 'undefined' ? JSON.parse(window.sessionStorage.getItem('TRADING_OWNER_SESSION') || '{}')?.token : null;
      if (token) {
        const wsUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1')
          .replace(/^http/, 'ws')
          .replace(/\/api\/v1\/?$/, '/ws');

        ws = new WebSocket(wsUrl, ['owner', token]);

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.topic === 'quotes.snapshot' && Array.isArray(data.payload)) {
              applyQuoteTicks(data.payload);
            } else if (data.topic === 'feed.status') {
              updateMarketCache({
                isLiveConnected: data.payload?.status === 'CONNECTED',
                ...(data.payload?.provenance ? { dataSource: data.payload.provenance } : {}),
              }, true);
            }
          } catch {}
        };
      }
    } catch {}

    return () => {
      isMounted = false;
      ws?.close();
    };
  }, []);

  // Periodic sync: only polls during active market hours; fetches once when market is closed
  useEffect(() => {
    let isMounted = true;
    const marketOpen = isMarketOpenForTrading();
    setIsMarketOpen(marketOpen);

    const refresh = async (isManual = false) => {
      if (isManual) setIsRefreshing(true);
      try {
        await fetchMarketData([selectedUnderlying]);
      } finally {
        if (isMounted && isManual) setIsRefreshing(false);
      }
    };

    // Always fetch closing/live snapshot upon mount or selection change
    void refresh(snapshotTrigger > 0);

    // If market is closed, DO NOT poll continuously. Save network, CPU, and API quotas.
    if (!marketOpen) {
      return () => {
        isMounted = false;
      };
    }

    const interval = setInterval(() => void refresh(false), 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedUnderlying, selectedExpiry, snapshotTrigger]);

  // Live instrument catalog search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let isMounted = true;
    apiClient
      .searchInstruments(searchQuery)
      .then((res) => {
        if (isMounted && res) {
          setSearchResults(res);
        }
      })
      .catch((failure) => { if (isMounted) { setSearchResults([]); setConnectionError(formatErrorMessage(failure) || 'Instrument search unavailable.'); } });
    return () => {
      isMounted = false;
    };
  }, [searchQuery]);

  const niftyQuote = watchlistQuotes[SPOT_KEYS.NIFTY];
  const bankNiftyQuote = watchlistQuotes[SPOT_KEYS.BANKNIFTY];
  const niftySpot = niftyQuote?.lastPrice > 0 ? niftyQuote.lastPrice : chains.NIFTY.spotPrice;
  const bankNiftySpot = bankNiftyQuote?.lastPrice > 0 ? bankNiftyQuote.lastPrice : chains.BANKNIFTY.spotPrice;
  const formatSpot = (price: number | null | undefined) =>
    price && price > 0 ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : isLoading ? 'Loading…' : 'Unavailable';

  const expiries = liveExpiries || [];
  const spotPrice = liveSpotPrice ?? (selectedUnderlying === 'NIFTY' ? niftySpot : bankNiftySpot) ?? 0;
  const lotSize = liveLotSize;
  const atmStrike = spotPrice > 0 ? Math.round(spotPrice / (selectedUnderlying === 'NIFTY' ? 50 : 100)) * (selectedUnderlying === 'NIFTY' ? 50 : 100) : 0;

  const effectiveOptionRows: OptionStrikeRow[] = liveOptionRows || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      {/* Header and Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
              Markets, Catalog & Option Chain
            </h1>
            <Badge
              label={isLiveConnected ? `DATA: ${dataSource}` : isLoading ? 'CONNECTING…' : 'DATA UNAVAILABLE'}
              variant={isLiveConnected ? 'success' : 'purple'}
              size="sm"
            />
            {isMarketOpen ? (
              <Badge label="🟢 MARKET OPEN" variant="success" size="sm" />
            ) : (
              <Badge label="🌙 MARKET CLOSED (Polling Paused)" variant="neutral" size="sm" />
            )}
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Real-time Upstox Market Data Feed V3 Protobuf decoding & F&O strike ladder.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setSnapshotTrigger((prev) => prev + 1)}
            disabled={isRefreshing}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.surfaceElevated,
              color: colors.textPrimary,
              border: `1px solid ${colors.border}`,
              fontSize: typography.fontSize.xs,
              cursor: isRefreshing ? 'wait' : 'pointer',
              fontWeight: typography.fontWeight.semibold,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh Quotes'}</span>
          </button>

          <button
            onClick={() => setIsSearchOpen(true)}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.surfaceElevated,
              color: colors.textPrimary,
              border: `1px solid ${colors.border}`,
              fontSize: typography.fontSize.xs,
              cursor: 'pointer',
              fontWeight: typography.fontWeight.semibold,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>🔍 Search F&O Contracts</span>
          </button>
        </div>
      </div>

      {connectionError && <div role="alert" style={{ color: colors.loss }}>{connectionError}</div>}
      {/* Market Closed Session Status Notice */}
      {!isMarketOpen && (
        <div
          style={{
            padding: `${spacing.sm}px ${spacing.md}px`,
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: borderRadius.md,
            color: '#38bdf8',
            fontSize: typography.fontSize.xs,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: spacing.xs,
          }}
        >
          <span>
            🌙 <strong>Market Closed</strong>: NSE trading hours are Mon–Fri 09:15–15:30 IST. API market data polling is paused to eliminate redundant bandwidth usage. Available snapshots retain their source and timestamp.
          </span>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
            Click <strong>Refresh Quotes</strong> anytime to sync
          </span>
        </div>
      )}

      {/* Stale Feed Warning Banner */}
      {isFeedStale && (
        <div
          style={{
            padding: spacing.md,
            backgroundColor: colors.warningMuted,
            border: `1px solid ${colors.warningBorder}`,
            borderRadius: borderRadius.md,
            color: colors.warning,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            Market data is stale or unavailable. Live entries require fresh broker quotes and executable depth.
          </span>
        </div>
      )}

      {/* Real-time Watchlist Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: spacing.md }}>
        {/* NIFTY 50 Spot */}
        <div
          onClick={() => setSelectedUnderlying('NIFTY')}
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${selectedUnderlying === 'NIFTY' ? colors.cyan : colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, fontWeight: typography.fontWeight.bold }}>
              NSE INDEX
            </span>
            <Badge label="LOT: 25" variant="neutral" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
            NIFTY 50
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
            <span style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, fontFamily: typography.fontFamily.mono }}>
              {formatSpot(niftySpot)}
            </span>
            {niftyQuote && (
              <span style={{ fontSize: typography.fontSize.xs, color: niftyQuote.netChange >= 0 ? colors.profit : colors.loss, fontWeight: typography.fontWeight.bold }}>
                {niftyQuote.netChange >= 0 ? '+' : ''}{niftyQuote.netChange.toFixed(2)} ({niftyQuote.netChangePct >= 0 ? '+' : ''}{niftyQuote.netChangePct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>

        {/* BANKNIFTY Spot */}
        <div
          onClick={() => setSelectedUnderlying('BANKNIFTY')}
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${selectedUnderlying === 'BANKNIFTY' ? colors.cyan : colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, fontWeight: typography.fontWeight.bold }}>
              NSE INDEX
            </span>
            <Badge label="LOT: 15" variant="neutral" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
            BANK NIFTY
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
            <span style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, fontFamily: typography.fontFamily.mono }}>
              {formatSpot(bankNiftySpot)}
            </span>
            {bankNiftyQuote && (
              <span style={{ fontSize: typography.fontSize.xs, color: bankNiftyQuote.netChange >= 0 ? colors.profit : colors.loss, fontWeight: typography.fontWeight.bold }}>
                {bankNiftyQuote.netChange >= 0 ? '+' : ''}{bankNiftyQuote.netChange.toFixed(2)} ({bankNiftyQuote.netChangePct >= 0 ? '+' : ''}{bankNiftyQuote.netChangePct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>

        {/* Market Timings & Calendar */}
        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>EXCHANGE STATUS</span>
            <Badge label={isMarketOpen ? "MARKET OPEN" : "MARKET CLOSED"} variant="success" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>
            Trading Hours: 09:15 - 15:30 IST
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
            WebSocket Latency: <span style={{ color: colors.profit }}>{feedLatencyMs === null ? 'Unavailable' : `${feedLatencyMs}ms`}</span> | {dataSource}
          </div>
        </div>
      </div>

      {/* Option Chain Control Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: spacing.md,
          flexWrap: 'wrap',
          gap: spacing.sm,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>EXPIRY DATE</span>
            <div style={{ marginTop: 2 }}>
              <select
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                style={{
                  backgroundColor: colors.surfaceElevated,
                  color: colors.textPrimary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm,
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.semibold,
                  cursor: 'pointer',
                }}
              >
                {expiries.map((exp) => (
                  <option key={exp} value={exp}>
                    {exp} (Weekly)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>SPOT PRICE</span>
            <div style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold, color: colors.profit, fontFamily: typography.fontFamily.mono }}>
              ₹{spotPrice.toFixed(2)}
            </div>
          </div>

          <div>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>STANDARD LOT</span>
            <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>
              {lotSize} units
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
          <Badge label={`ATM: ${atmStrike}`} variant="warning" />
          <Badge label="5-LEVEL DEPTH" variant="primary" />
        </div>
      </div>

      {/* Dense Option Chain Table */}
      <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: typography.fontSize.xs }}>
          <thead>
            <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}` }}>
              <th colSpan={5} style={{ padding: spacing.sm, color: '#60A5FA', borderRight: `1px solid ${colors.border}` }}>
                CALL OPTIONS (CE)
              </th>
              <th style={{ padding: spacing.sm, color: colors.textPrimary }}>STRIKE</th>
              <th colSpan={5} style={{ padding: spacing.sm, color: '#F472B6', borderLeft: `1px solid ${colors.border}` }}>
                PUT OPTIONS (PE)
              </th>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
              <th style={{ padding: spacing.xs }}>OI</th>
              <th style={{ padding: spacing.xs }}>VOL</th>
              <th style={{ padding: spacing.xs }}>BID/ASK</th>
              <th style={{ padding: spacing.xs }}>CHG%</th>
              <th style={{ padding: spacing.xs, borderRight: `1px solid ${colors.border}`, color: '#60A5FA' }}>LTP (CE)</th>
              <th style={{ padding: spacing.xs, color: colors.cyan }}>STRIKE</th>
              <th style={{ padding: spacing.xs, borderLeft: `1px solid ${colors.border}`, color: '#F472B6' }}>LTP (PE)</th>
              <th style={{ padding: spacing.xs }}>CHG%</th>
              <th style={{ padding: spacing.xs }}>BID/ASK</th>
              <th style={{ padding: spacing.xs }}>VOL</th>
              <th style={{ padding: spacing.xs }}>OI</th>
            </tr>
          </thead>
          <tbody>
            {effectiveOptionRows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: spacing.xl, color: colors.textMuted, textAlign: 'center', fontSize: typography.fontSize.sm }}>
                  No verified option contracts are available for {selectedUnderlying} ({selectedExpiry || 'expiry unavailable'}). Check the instrument catalogue and market feed.
                </td>
              </tr>
            ) : (
              effectiveOptionRows.map((row) => {
                const isAtm = row.strikePrice === atmStrike;
                const isCallItm = spotPrice > 0 && row.strikePrice < spotPrice;
                const isPutItm = spotPrice > 0 && row.strikePrice > spotPrice;
                const callKnown = !!row.call && row.call.provenance !== 'UNAVAILABLE' && row.call.lastPrice > 0;
                const putKnown = !!row.put && row.put.provenance !== 'UNAVAILABLE' && row.put.lastPrice > 0;

                return (
                  <tr
                    key={row.strikePrice}
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      backgroundColor: isAtm ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                    }}
                  >
                    {/* Call Data */}
                    <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                      {callKnown ? `${((row.call?.openInterest || 0) / 1000).toFixed(0)}k` : '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {callKnown ? `${((row.call?.volume || 0) / 1000).toFixed(0)}k` : '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {row.call?.bidPrice || '--'} / {row.call?.askPrice || '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: (row.call?.netChangePct || 0) >= 0 ? colors.profit : colors.loss }}>
                      {callKnown ? `${(row.call?.netChangePct || 0) > 0 ? '+' : ''}${row.call?.netChangePct || 0}%` : '--'}
                    </td>
                    <td
                      style={{
                        padding: spacing.sm,
                        fontWeight: typography.fontWeight.bold,
                        color: '#60A5FA',
                        borderRight: `1px solid ${colors.border}`,
                        backgroundColor: isCallItm ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                        fontFamily: typography.fontFamily.mono,
                      }}
                    >
                      {row.call?.lastPrice ? `₹${row.call.lastPrice.toFixed(2)}` : '--'}
                      <div style={{ fontSize: 9, color: colors.textMuted }}>{row.call?.provenance || 'UNAVAILABLE'}{row.call?.isStale && row.call.provenance !== 'UNAVAILABLE' ? ' · STALE' : ''}</div>
                    </td>

                    {/* Center Strike */}
                    <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                      {row.strikePrice} {isAtm && <Badge label="ATM" variant="warning" size="sm" />}
                    </td>

                    {/* Put Data */}
                    <td
                      style={{
                        padding: spacing.sm,
                        fontWeight: typography.fontWeight.bold,
                        color: '#F472B6',
                        borderLeft: `1px solid ${colors.border}`,
                        backgroundColor: isPutItm ? 'rgba(244, 114, 182, 0.05)' : 'transparent',
                        fontFamily: typography.fontFamily.mono,
                      }}
                    >
                      {row.put?.lastPrice ? `₹${row.put.lastPrice.toFixed(2)}` : '--'}
                      <div style={{ fontSize: 9, color: colors.textMuted }}>{row.put?.provenance || 'UNAVAILABLE'}{row.put?.isStale && row.put.provenance !== 'UNAVAILABLE' ? ' · STALE' : ''}</div>
                    </td>
                    <td style={{ padding: spacing.sm, color: (row.put?.netChangePct || 0) >= 0 ? colors.profit : colors.loss }}>
                      {putKnown ? `${(row.put?.netChangePct || 0) > 0 ? '+' : ''}${row.put?.netChangePct || 0}%` : '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {row.put?.bidPrice || '--'} / {row.put?.askPrice || '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {putKnown ? `${((row.put?.volume || 0) / 1000).toFixed(0)}k` : '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                      {putKnown ? `${((row.put?.openInterest || 0) / 1000).toFixed(0)}k` : '--'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Search Modal */}
      {isSearchOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              width: '100%',
              maxWidth: 600,
              padding: spacing.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.md,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>F&O Instrument Catalog Search</h3>
              <button
                onClick={() => setIsSearchOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.textMuted,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <input
              type="text"
              placeholder="Search e.g. NIFTY 25100 CE, BANKNIFTY..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                backgroundColor: colors.surfaceElevated,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                padding: `${spacing.sm}px ${spacing.md}px`,
                color: colors.textPrimary,
                fontSize: typography.fontSize.sm,
                outline: 'none',
              }}
            />

            <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
              {searchResults.length > 0 ? (
                searchResults.map((item: any) => {
                  const type = item.instrumentType || (item.symbol?.includes('CE') ? 'CE' : 'PE');
                  const ltp = item.lastPrice || 0;
                  return (
                    <div
                      key={item.instrumentKey}
                      style={{
                        padding: spacing.sm,
                        backgroundColor: colors.surfaceElevated,
                        borderRadius: borderRadius.sm,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: typography.fontWeight.semibold, fontSize: typography.fontSize.xs }}>
                          {item.symbol}
                        </div>
                        <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>
                          Lot Size: {item.lotSize || 25} | Token: {item.instrumentKey}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                        {ltp > 0 && <span style={{ fontWeight: typography.fontWeight.bold, color: colors.cyan }}>₹{ltp.toFixed(2)}</span>}
                        <Badge label={type} variant={type === 'CE' ? 'primary' : 'danger'} size="sm" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ padding: spacing.lg, textAlign: 'center', color: colors.textMuted, fontSize: typography.fontSize.sm }}>
                  {searchQuery.trim() ? `No instruments found matching "${searchQuery}".` : 'Enter a contract symbol (e.g. NIFTY, 25100 CE, BANKNIFTY) to search.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
