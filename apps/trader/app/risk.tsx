import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';
import { useWorkstation } from '../src/hooks/useWorkstation';

export default function RiskCenterScreen() {
  const { state, armRisk, disarmRisk, emergencyStop, resetKillSwitch } = useWorkstation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
          Risk Control Center
        </h1>
        <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
          Deterministic portfolio-level risk engine. Authoritative across all agents and devices.
        </p>
      </div>

      {/* Emergency Action Panel */}
      <div
        style={{
          backgroundColor: state.riskState === 'EMERGENCY_STOP' ? colors.lossMuted : colors.surface,
          border: `1px solid ${state.riskState === 'EMERGENCY_STOP' ? colors.loss : colors.border}`,
          borderRadius: borderRadius.md,
          padding: spacing.lg,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.md,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>Emergency Controls & Kill Switch</h2>
            <Badge
              label={state.riskState === 'EMERGENCY_STOP' ? 'SYSTEM FROZEN' : 'ACTIVE'}
              variant={state.riskState === 'EMERGENCY_STOP' ? 'danger' : 'success'}
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
            Halts all new trade submissions immediately and freezes orchestrator pipelines.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm }}>
          {state.riskState === 'EMERGENCY_STOP' ? (
            <button
              onClick={resetKillSwitch}
              style={{
                padding: `${spacing.sm}px ${spacing.lg}px`,
                backgroundColor: colors.surfaceElevated,
                color: colors.textPrimary,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                fontWeight: typography.fontWeight.bold,
                cursor: 'pointer',
                fontSize: typography.fontSize.xs,
              }}
            >
              Reset Emergency State
            </button>
          ) : (
            <button
              onClick={emergencyStop}
              style={{
                padding: `${spacing.sm}px ${spacing.lg}px`,
                backgroundColor: colors.loss,
                color: '#FFFFFF',
                border: 'none',
                borderRadius: borderRadius.md,
                fontWeight: typography.fontWeight.bold,
                cursor: 'pointer',
                fontSize: typography.fontSize.xs,
              }}
            >
              🚨 ACTIVATE KILL SWITCH
            </button>
          )}
        </div>
      </div>

      {/* Arming Session Controls */}
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
        <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>Execution Mode & Session Arming</h3>
        <p style={{ margin: 0, color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
          Live trading requires explicit arming for a bounded time window. System defaults to DISARMED on restarts.
        </p>

        <div style={{ display: 'flex', gap: spacing.md, flexWrap: 'wrap' }}>
          <button
            onClick={() => armRisk(30)}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.warningMuted,
              color: colors.warning,
              border: `1px solid ${colors.warningBorder}`,
              fontWeight: typography.fontWeight.bold,
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Arm for 30 Minutes
          </button>
          <button
            onClick={() => armRisk(60)}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.warningMuted,
              color: colors.warning,
              border: `1px solid ${colors.warningBorder}`,
              fontWeight: typography.fontWeight.bold,
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Arm for 60 Minutes
          </button>
          <button
            onClick={disarmRisk}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.surfaceElevated,
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              fontWeight: typography.fontWeight.bold,
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Disarm (Default Safe)
          </button>
        </div>
      </div>

      {/* Hard Risk Caps Table */}
      <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing.md }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: typography.fontSize.md }}>Active Hard Risk Safeguards</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
          <thead>
            <tr style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: spacing.xs }}>PARAMETER</th>
              <th style={{ padding: spacing.xs }}>LIMIT VALUE</th>
              <th style={{ padding: spacing.xs }}>CURRENT STATUS</th>
              <th style={{ padding: spacing.xs }}>INVARIANT RULE</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>Total Trading Capital</td>
              <td style={{ padding: spacing.sm, color: colors.cyan }}>₹10,000.00</td>
              <td style={{ padding: spacing.sm }}>₹9,450.00 Available</td>
              <td style={{ padding: spacing.sm, color: colors.textMuted }}>Central account-wide lock</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>Max Per-Trade All-In Risk</td>
              <td style={{ padding: spacing.sm, color: colors.loss }}>₹500.00</td>
              <td style={{ padding: spacing.sm }}>₹270.70 Active</td>
              <td style={{ padding: spacing.sm, color: colors.textMuted }}>Loss + roundtrip fees + slippage</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>Daily Drawdown Cap</td>
              <td style={{ padding: spacing.sm, color: colors.loss }}>₹1,500.00</td>
              <td style={{ padding: spacing.sm }}>₹0.00 / ₹1,500.00</td>
              <td style={{ padding: spacing.sm, color: colors.textMuted }}>Exceeding locks new entries</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>Max Open Positions</td>
              <td style={{ padding: spacing.sm, color: colors.cyan }}>1 Position</td>
              <td style={{ padding: spacing.sm }}>1 / 1 Open</td>
              <td style={{ padding: spacing.sm, color: colors.textMuted }}>Strict concurrency serial gate</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
