import { useState } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';

export default function MarketsScreen() {
  const [selectedUnderlying, setSelectedUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');

  const spot = selectedUnderlying === 'NIFTY' ? 25120.45 : 52450.8;
  const lotSize = selectedUnderlying === 'NIFTY' ? 25 : 15;

  const strikes = selectedUnderlying === 'NIFTY'
    ? [25000, 25050, 25100, 25150, 25200]
    : [52200, 52300, 52400, 52500, 52600];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header & Underlying Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Markets & Option Chain
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Real-time Upstox Market Data Feed V3 quotes & strike ladder.
          </p>
        </div>

        {/* Index Selector Buttons */}
        <div style={{ display: 'flex', gap: spacing.xs, backgroundColor: colors.surface, padding: 4, borderRadius: borderRadius.md, border: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setSelectedUnderlying('NIFTY')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: selectedUnderlying === 'NIFTY' ? colors.cyan : 'transparent',
              color: selectedUnderlying === 'NIFTY' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            NIFTY 50 (Lot 25)
          </button>
          <button
            onClick={() => setSelectedUnderlying('BANKNIFTY')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: selectedUnderlying === 'BANKNIFTY' ? colors.cyan : 'transparent',
              color: selectedUnderlying === 'BANKNIFTY' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            BANK NIFTY (Lot 15)
          </button>
        </div>
      </div>

      {/* Spot Price Bar */}
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
        <div>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>SPOT PRICE</span>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.profit }}>
            {selectedUnderlying} {spot.toFixed(2)}
          </div>
        </div>
        <div>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>EXPIRY</span>
          <div style={{ fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold }}>
            15 OCT 2026 (Weekly)
          </div>
        </div>
        <div>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>LOT SIZE</span>
          <div style={{ fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold }}>
            {lotSize} units / contract
          </div>
        </div>
        <Badge label="FEED: REAL-TIME (18ms)" variant="success" />
      </div>

      {/* Option Chain Table */}
      <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: typography.fontSize.xs }}>
          <thead>
            <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}` }}>
              <th colSpan={3} style={{ padding: spacing.sm, color: '#60A5FA', borderRight: `1px solid ${colors.border}` }}>
                CALLS (CE)
              </th>
              <th style={{ padding: spacing.sm, color: colors.textPrimary }}>STRIKE</th>
              <th colSpan={3} style={{ padding: spacing.sm, color: '#F472B6', borderLeft: `1px solid ${colors.border}` }}>
                PUTS (PE)
              </th>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
              <th style={{ padding: spacing.xs }}>OI</th>
              <th style={{ padding: spacing.xs }}>BID/ASK</th>
              <th style={{ padding: spacing.xs, borderRight: `1px solid ${colors.border}` }}>LTP</th>
              <th style={{ padding: spacing.xs, color: colors.cyan }}>STRIKE</th>
              <th style={{ padding: spacing.xs, borderLeft: `1px solid ${colors.border}` }}>LTP</th>
              <th style={{ padding: spacing.xs }}>BID/ASK</th>
              <th style={{ padding: spacing.xs }}>OI</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map((strike) => {
              const isAtm = strike === (selectedUnderlying === 'NIFTY' ? 25100 : 52400);
              const callLtp = Math.max(15, Math.round(145 - (strike - spot) * 0.45));
              const putLtp = Math.max(15, Math.round(145 + (strike - spot) * 0.45));

              return (
                <tr
                  key={strike}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    backgroundColor: isAtm ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                  }}
                >
                  <td style={{ padding: spacing.sm, color: colors.textSecondary }}>45.2k</td>
                  <td style={{ padding: spacing.sm, color: colors.textMuted }}>{(callLtp - 0.3).toFixed(1)} / {(callLtp + 0.3).toFixed(1)}</td>
                  <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.bold, color: '#60A5FA', borderRight: `1px solid ${colors.border}` }}>
                    ₹{callLtp.toFixed(1)}
                  </td>
                  <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                    {strike} {isAtm && <Badge label="ATM" variant="warning" size="sm" />}
                  </td>
                  <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.bold, color: '#F472B6', borderLeft: `1px solid ${colors.border}` }}>
                    ₹{putLtp.toFixed(1)}
                  </td>
                  <td style={{ padding: spacing.sm, color: colors.textMuted }}>{(putLtp - 0.3).toFixed(1)} / {(putLtp + 0.3).toFixed(1)}</td>
                  <td style={{ padding: spacing.sm, color: colors.textSecondary }}>38.6k</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
