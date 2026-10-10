import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';

export default function StrategiesScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Strategy Library & Builder
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Deterministic rule-based strategy definitions with immutable versioning.
          </p>
        </div>

        <button
          style={{
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderRadius: borderRadius.md,
            backgroundColor: colors.cyan,
            color: '#082F49',
            fontWeight: typography.fontWeight.bold,
            border: 'none',
            cursor: 'pointer',
            fontSize: typography.fontSize.xs,
          }}
        >
          + Create Strategy Draft
        </button>
      </div>

      {/* Active Strategy Card */}
      <div
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: spacing.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.md,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>NIFTY EMA20 RSI Long Call</h2>
              <Badge label="v1.0" variant="primary" />
              <Badge label="PAPER_ACTIVE" variant="purple" />
            </div>
            <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
              Underlying: NIFTY 50 | Timeframe: 5m | Allowed: LONG_CALL (ATM)
            </p>
          </div>

          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Badge label="APPROVAL REQUIRED" variant="warning" />
          </div>
        </div>

        {/* Configuration Rules Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: spacing.md }}>
          {/* Entry Conditions */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginBottom: spacing.xs }}>
              ENTRY CRITERIA (ALL REQUIRED)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>EMA(20) Cross Above on 5m close</li>
              <li>RSI(14) &gt; 55 bullish momentum confirmation</li>
              <li>Bid/Ask spread &lt; 1.0% maximum liquidity gate</li>
              <li>Selection: Nearest weekly expiry, ATM strike</li>
            </ul>
          </div>

          {/* Risk Guardrails */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.warning, marginBottom: spacing.xs }}>
              RISK GUARDRAILS (HARD GATES)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>Max Capital: ₹10,000 (Account total)</li>
              <li>Max All-In Trade Risk: ₹200.00 (Loss + charges)</li>
              <li>Max Daily Loss: ₹600.00</li>
              <li>Target Net Profit: ₹300.00 net after ₹60 roundtrip costs</li>
              <li>Max Open Positions: 1 contract</li>
            </ul>
          </div>

          {/* Exit Rules */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.profit, marginBottom: spacing.xs }}>
              EXIT RULES & CUTOFFS
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>Stop basis: Option premium SL with GTT multi-leg</li>
              <li>Target basis: Fixed ₹300 net gain target</li>
              <li>Intraday cutoff: 15:10 IST automatic square-off check</li>
              <li>Emergency action: Flatten on feed drop &gt; 10s</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
