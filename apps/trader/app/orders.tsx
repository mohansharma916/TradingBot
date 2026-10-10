import { useState } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';

export default function OrdersScreen() {
  const [tab, setTab] = useState<'positions' | 'orders'>('positions');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Orders & Positions
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Broker-verified fills, open contracts, and GTT protective exits.
          </p>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: spacing.xs, backgroundColor: colors.surface, padding: 4, borderRadius: borderRadius.md, border: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setTab('positions')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: tab === 'positions' ? colors.cyan : 'transparent',
              color: tab === 'positions' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Positions (1)
          </button>
          <button
            onClick={() => setTab('orders')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: tab === 'orders' ? colors.cyan : 'transparent',
              color: tab === 'orders' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Order History (1)
          </button>
        </div>
      </div>

      {tab === 'positions' ? (
        /* Positions Card */
        <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing.sm }}>
            <div>
              <div style={{ fontWeight: typography.fontWeight.bold, fontSize: typography.fontSize.md }}>
                NIFTY26OCT25100CE
              </div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                NSE_FO | Long Option (Intraday MIS)
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold, color: colors.profit }}>
                +₹50.00 (+1.63%)
              </div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Unrealized P&L</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: spacing.md, marginTop: spacing.md }}>
            <div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>NET QUANTITY</div>
              <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>25 (1 Lot)</div>
            </div>
            <div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>AVG BUY PRICE</div>
              <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>₹122.50</div>
            </div>
            <div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>CURRENT LTP</div>
              <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>₹124.50</div>
            </div>
            <div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROTECTIVE STOP</div>
              <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.loss }}>₹114.00 (GTT)</div>
            </div>
            <div>
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROFIT TARGET</div>
              <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.profit }}>₹136.00 (GTT)</div>
            </div>
          </div>
        </div>
      ) : (
        /* Orders History Table */
        <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
            <thead>
              <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                <th style={{ padding: spacing.sm }}>TIME</th>
                <th style={{ padding: spacing.sm }}>SYMBOL</th>
                <th style={{ padding: spacing.sm }}>SIDE</th>
                <th style={{ padding: spacing.sm }}>QTY</th>
                <th style={{ padding: spacing.sm }}>PRICE</th>
                <th style={{ padding: spacing.sm }}>TAG</th>
                <th style={{ padding: spacing.sm }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: spacing.sm, color: colors.textSecondary }}>09:45:12</td>
                <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>NIFTY26OCT25100CE</td>
                <td style={{ padding: spacing.sm, color: '#60A5FA', fontWeight: typography.fontWeight.bold }}>BUY</td>
                <td style={{ padding: spacing.sm }}>25 / 25</td>
                <td style={{ padding: spacing.sm }}>₹122.50</td>
                <td style={{ padding: spacing.sm, color: colors.textMuted }}>STRAT_EMA_01</td>
                <td style={{ padding: spacing.sm }}><Badge label="FILLED" variant="success" size="sm" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
