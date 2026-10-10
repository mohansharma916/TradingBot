import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { StatCard, Badge } from '@trading-bot/ui';

export default function DashboardScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xl, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Workstation Dashboard
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Real-time Indian F&O Portfolio, Risk Limits, and Agent Intelligence.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
          <Badge label="PAPER SIMULATION" variant="purple" />
          <Badge label="UPSTOX CONNECTED" variant="success" />
        </div>
      </div>

      {/* Financial Stat Widgets Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: spacing.md }}>
        <StatCard
          label="Total Capital"
          value="₹10,000.00"
          subValue="Account-wide hard cap"
        />
        <StatCard
          label="Available Cash"
          value="₹9,450.00"
          subValue="₹550.00 in margin & risk buffer"
        />
        <StatCard
          label="Realized Net P&L"
          value="+₹291.60"
          subValue="After all ₹58.40 taxes & fees"
          trend="profit"
        />
        <StatCard
          label="Max Per-Trade Risk"
          value="₹500.00"
          subValue="All-in cap including fees & slip"
          trend="loss"
        />
      </div>

      {/* Daily Milestone Card */}
      <div
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: spacing.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.sm,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.cyan }}>
            🎯 Informational Daily Goal: ₹4,000.00 (40% Milestone)
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
            Progress: ₹291.60 / ₹4,000.00 (7.3%)
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ width: '100%', height: 8, backgroundColor: colors.surfaceElevated, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: '7.3%', height: '100%', backgroundColor: colors.profit, borderRadius: 4 }} />
        </div>

        <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 4 }}>
          <strong>Safety Invariant:</strong> This daily profit target is strictly informational. It will never force a trade, increase risk limits, or bypass the ₹1,500 daily drawdown cap.
        </div>
      </div>

      {/* Two Column Section: Active Position & Agent Roster */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: spacing.lg }}>
        {/* Open Positions Card */}
        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>Active F&O Position (1 / 1 Max)</h3>
            <Badge label="LONG CE" variant="primary" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.sm }}>
              <span style={{ fontWeight: typography.fontWeight.semibold }}>NIFTY26OCT25100CE</span>
              <span style={{ color: colors.profit, fontWeight: typography.fontWeight.bold }}>+₹50.00 (+1.63%)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
              <span>Qty: 25 (1 Lot) | Avg: ₹122.50</span>
              <span>LTP: ₹124.50</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.xs, color: colors.textMuted, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.xs }}>
              <span>Stop: ₹114.00 (-₹212.50)</span>
              <span>Target: ₹136.00 (+₹337.50)</span>
            </div>
          </div>
        </div>

        {/* Specialized Agents Status */}
        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>Specialized AI Agents</h3>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Shared ₹10,000 Budget</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {[
              { name: 'Market Scanner', status: 'Scanning liquid NIFTY strikes', state: 'ACTIVE' },
              { name: 'Strategy Analyst', status: '5m EMA & RSI confirmation', state: 'ACTIVE' },
              { name: 'Risk Reviewer', status: 'Validating all-in trade budget', state: 'ARMED' },
              { name: 'Position Monitor', status: 'Tracking GTT multi-leg exit', state: 'MONITORING' },
            ].map((agent) => (
              <div
                key={agent.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: spacing.xs,
                  borderBottom: `1px solid ${colors.border}`,
                  fontSize: typography.fontSize.xs,
                }}
              >
                <div>
                  <div style={{ fontWeight: typography.fontWeight.semibold, color: colors.textPrimary }}>{agent.name}</div>
                  <div style={{ color: colors.textSecondary }}>{agent.status}</div>
                </div>
                <Badge label={agent.state} variant="success" size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
