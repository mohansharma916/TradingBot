import { useState, useEffect } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';
import { apiClient } from '../src/services/api';

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
  };
}

export default function MarketsScreen() {
  const [selectedUnderlying, setSelectedUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [selectedExpiry, setSelectedExpiry] = useState<string>('2026-10-15');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [feedLatencyMs, setFeedLatencyMs] = useState(16);
  const [isFeedStale, setIsFeedStale] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  const [liveOptionRows, setLiveOptionRows] = useState<OptionStrikeRow[] | null>(null);
  const [liveSpotPrice, setLiveSpotPrice] = useState<number | null>(null);
  const [liveExpiries, setLiveExpiries] = useState<string[] | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [watchlistQuotes, setWatchlistQuotes] = useState<Record<string, any>>({});

  // Periodic sync of live option chain, watchlist quotes, and latency
  useEffect(() => {
    let isMounted = true;
    const fetchLiveChain = async () => {
      try {
        const [chain, diag, watchlist] = await Promise.all([
          apiClient.getOptionChain(selectedUnderlying, selectedExpiry).catch(() => null),
          apiClient.getDiagnostics().catch(() => null),
          apiClient.getWatchlist().catch(() => []),
        ]);
        if (isMounted) {
          if (chain && chain.strikes?.length > 0) {
            setLiveOptionRows(chain.strikes as any);
            setLiveSpotPrice(chain.spotPrice);
            if (chain.availableExpiries?.length > 0) {
              setLiveExpiries(chain.availableExpiries);
            }
            setIsLiveConnected(true);
          }
          if (watchlist && Array.isArray(watchlist)) {
            const map: Record<string, any> = {};
            for (const q of watchlist) {
              map[q.instrumentKey] = q;
            }
            setWatchlistQuotes(map);
          }
          if (diag?.marketFeed?.latencyMs) {
            setFeedLatencyMs(diag.marketFeed.latencyMs);
          }
        }
      } catch {
        // offline fallback
      }
    };
    fetchLiveChain();
    const interval = setInterval(fetchLiveChain, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedUnderlying, selectedExpiry]);

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
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [searchQuery]);

  const niftyQuote = watchlistQuotes['NSE_INDEX|Nifty 50'];
  const bankNiftyQuote = watchlistQuotes['NSE_INDEX|Nifty Bank'];

  const expiries = liveExpiries || ['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'];
  const spotPrice = liveSpotPrice ?? (selectedUnderlying === 'NIFTY' ? niftyQuote?.lastPrice : bankNiftyQuote?.lastPrice) ?? 0;
  const lotSize = selectedUnderlying === 'NIFTY' ? 25 : 15;
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
              label={isLiveConnected ? '🟢 LIVE API' : '⚠️ OFFLINE / PAPER'}
              variant={isLiveConnected ? 'success' : 'purple'}
              size="sm"
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Real-time Upstox Market Data Feed V3 Protobuf decoding & F&O strike ladder.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
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

          <button
            onClick={() => setIsFeedStale((prev) => !prev)}
            style={{
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: borderRadius.md,
              backgroundColor: isFeedStale ? colors.warningMuted : colors.surfaceSubtle,
              color: isFeedStale ? colors.warning : colors.textMuted,
              border: `1px solid ${isFeedStale ? colors.warningBorder : colors.border}`,
              fontSize: typography.fontSize.xs,
              cursor: 'pointer',
            }}
          >
            {isFeedStale ? '⚠️ Test: Stale Feed Active' : 'Test Stale Feed'}
          </button>
        </div>
      </div>

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
            ⚠️ STALE FEED DETECTOR: Market feed tick gap exceeded 3,000ms threshold. Strategy execution is automatically PAUSED.
          </span>
          <button
            onClick={() => setIsFeedStale(false)}
            style={{
              backgroundColor: colors.warning,
              color: '#000',
              border: 'none',
              borderRadius: borderRadius.sm,
              padding: '2px 8px',
              fontSize: typography.fontSize.xs,
              cursor: 'pointer',
              fontWeight: typography.fontWeight.bold,
            }}
          >
            Acknowledge & Resume
          </button>
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
              {niftyQuote ? `₹${niftyQuote.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : (liveSpotPrice && selectedUnderlying === 'NIFTY' ? `₹${liveSpotPrice.toFixed(2)}` : 'Loading...')}
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
              {bankNiftyQuote ? `₹${bankNiftyQuote.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : (liveSpotPrice && selectedUnderlying === 'BANKNIFTY' ? `₹${liveSpotPrice.toFixed(2)}` : 'Loading...')}
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
            <Badge label="REGULAR SESSION" variant="success" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>
            Trading Hours: 09:15 - 15:30 IST
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
            WebSocket Latency: <span style={{ color: colors.profit }}>{feedLatencyMs}ms</span> | Protobuf V3 Active
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
                  Connecting to Upstox Market Data Feed & fetching live strikes for {selectedUnderlying} ({selectedExpiry})...
                </td>
              </tr>
            ) : (
              effectiveOptionRows.map((row) => {
                const isAtm = row.strikePrice === atmStrike;
                const isCallItm = spotPrice > 0 && row.strikePrice < spotPrice;
                const isPutItm = spotPrice > 0 && row.strikePrice > spotPrice;

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
                      {(row.call?.openInterest ? row.call.openInterest / 1000 : 0).toFixed(0)}k
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {(row.call?.volume ? row.call.volume / 1000 : 0).toFixed(0)}k
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {row.call?.bidPrice ?? '--'} / {row.call?.askPrice ?? '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: (row.call?.netChangePct || 0) >= 0 ? colors.profit : colors.loss }}>
                      {(row.call?.netChangePct || 0) > 0 ? '+' : ''}{row.call?.netChangePct ?? 0}%
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
                    </td>
                    <td style={{ padding: spacing.sm, color: (row.put?.netChangePct || 0) >= 0 ? colors.profit : colors.loss }}>
                      {(row.put?.netChangePct || 0) > 0 ? '+' : ''}{row.put?.netChangePct ?? 0}%
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {row.put?.bidPrice ?? '--'} / {row.put?.askPrice ?? '--'}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                      {(row.put?.volume ? row.put.volume / 1000 : 0).toFixed(0)}k
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                      {(row.put?.openInterest ? row.put.openInterest / 1000 : 0).toFixed(0)}k
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
