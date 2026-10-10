import { useState } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { useWorkstation } from '../src/hooks/useWorkstation';

export default function RiskCenterScreen() {
  const {
    state,
    isFlattening,
    armRisk,
    disarmRisk,
    emergencyStop,
    resetKillSwitch,
    flattenPositions,
  } = useWorkstation();

  const [showFlattenModal, setShowFlattenModal] = useState(false);
  const [flattenReason, setFlattenReason] = useState('Manual risk operator intervention');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleConfirmFlatten = async () => {
    const res = await flattenPositions(flattenReason);
    setShowFlattenModal(false);
    showToast(res.message);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.lg,
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        paddingBottom: spacing.xxl,
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            backgroundColor: colors.surfaceElevated,
            color: colors.profit,
            border: `1px solid ${colors.profit}`,
            borderRadius: borderRadius.md,
            padding: `${spacing.sm}px ${spacing.md}px`,
            zIndex: 9999,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h1
              style={{
                margin: 0,
                fontSize: typography.fontSize.xxl,
                fontWeight: typography.fontWeight.bold,
              }}
            >
              Risk Control Center
            </h1>
            <Badge
              label={state.isLiveSynced ? '🟢 LIVE API SYNCED' : '⚠️ OFFLINE / PAPER SIMULATION'}
              variant={state.isLiveSynced ? 'success' : 'purple'}
              size="sm"
            />
          </div>
          <p
            style={{
              margin: '4px 0 0 0',
              color: colors.textSecondary,
              fontSize: typography.fontSize.sm,
            }}
          >
            Deterministic portfolio-level risk engine. Authoritative across all agents and devices.
          </p>
        </div>
      </div>

      {/* Live Capital & Reservation Telemetry Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: spacing.md,
        }}
      >
        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>
            TOTAL ACCOUNT CAPITAL
          </div>
          <div
            style={{
              fontSize: typography.fontSize.xl,
              fontWeight: typography.fontWeight.bold,
              color: colors.cyan,
              marginTop: 4,
            }}
          >
            ₹{state.totalCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            Hard account cap: ₹10,000
          </div>
        </div>

        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>
            AVAILABLE CASH
          </div>
          <div
            style={{
              fontSize: typography.fontSize.xl,
              fontWeight: typography.fontWeight.bold,
              color: colors.textPrimary,
              marginTop: 4,
            }}
          >
            ₹{state.availableCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            Atomic pre-trade debit gate
          </div>
        </div>

        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>
            OPEN POSITIONS & RESERVATIONS
          </div>
          <div
            style={{
              fontSize: typography.fontSize.xl,
              fontWeight: typography.fontWeight.bold,
              color: state.openPositionsCount > 0 ? colors.warning : colors.profit,
              marginTop: 4,
            }}
          >
            {state.openPositionsCount} Open / {state.activeReservationsCount} Held
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            Max concurrency limit: 1 position
          </div>
        </div>

        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
          }}
        >
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>
            ENGINE RISK STATE
          </div>
          <div style={{ marginTop: 6 }}>
            <Badge
              label={state.riskState}
              variant={
                state.riskState === 'ARMED'
                  ? 'success'
                  : state.riskState === 'EMERGENCY_STOP'
                  ? 'danger'
                  : 'neutral'
              }
              size="md"
            />
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 6 }}>
            Egress IP: {state.egressIpVerified ? 'Verified 127.0.0.1' : 'Unverified'}
          </div>
        </div>
      </div>

      {/* Decoupled Dual Emergency Action Panel (Blueprint Section 8 & 12) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: spacing.md,
        }}
      >
        {/* Control 1: Stop New Trades (Kill Switch Gate) */}
        <div
          style={{
            backgroundColor:
              state.riskState === 'EMERGENCY_STOP' ? colors.lossMuted : colors.surface,
            border: `1px solid ${
              state.riskState === 'EMERGENCY_STOP' ? colors.loss : colors.border
            }`,
            borderRadius: borderRadius.md,
            padding: spacing.lg,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.md }}>
                Control A: Stop New Trades (Kill Switch)
              </h2>
              <Badge
                label={state.riskState === 'EMERGENCY_STOP' ? 'ENGAGED' : 'READY'}
                variant={state.riskState === 'EMERGENCY_STOP' ? 'danger' : 'success'}
              />
            </div>
            <p
              style={{
                margin: '8px 0 0 0',
                color: colors.textSecondary,
                fontSize: typography.fontSize.xs,
                lineHeight: 1.5,
              }}
            >
              Strict intake gate. Freezes proposal evaluation and halts order dispatch. Does NOT
              close currently working protective exits.
            </p>
          </div>

          <div>
            {state.riskState === 'EMERGENCY_STOP' ? (
              <button
                onClick={resetKillSwitch}
                style={{
                  width: '100%',
                  padding: `${spacing.sm}px ${spacing.lg}px`,
                  backgroundColor: colors.surfaceElevated,
                  color: colors.profit,
                  border: `1px solid ${colors.profit}`,
                  borderRadius: borderRadius.md,
                  fontWeight: typography.fontWeight.bold,
                  cursor: 'pointer',
                  fontSize: typography.fontSize.sm,
                }}
              >
                ✅ Reset Kill Switch (Restore DISARMED)
              </button>
            ) : (
              <button
                onClick={emergencyStop}
                style={{
                  width: '100%',
                  padding: `${spacing.sm}px ${spacing.lg}px`,
                  backgroundColor: colors.loss,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: borderRadius.md,
                  fontWeight: typography.fontWeight.bold,
                  cursor: 'pointer',
                  fontSize: typography.fontSize.sm,
                }}
              >
                🚨 ENGAGE KILL SWITCH (STOP NEW TRADES)
              </button>
            )}
          </div>
        </div>

        {/* Control 2: Request Flatten All (Active Exits) */}
        <div
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.warningBorder}`,
            borderRadius: borderRadius.md,
            padding: spacing.lg,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.md, color: colors.warning }}>
                Control B: Request Flatten All Positions
              </h2>
              <Badge
                label={state.openPositionsCount > 0 ? `${state.openPositionsCount} ACTIVE` : 'FLAT'}
                variant={state.openPositionsCount > 0 ? 'warning' : 'neutral'}
              />
            </div>
            <p
              style={{
                margin: '8px 0 0 0',
                color: colors.textSecondary,
                fontSize: typography.fontSize.xs,
                lineHeight: 1.5,
              }}
            >
              Independent active exit trigger. Submits market exit orders, settles capital
              reservations, and sets engine state to DISARMED.
            </p>
          </div>

          <div>
            <button
              onClick={() => setShowFlattenModal(true)}
              disabled={isFlattening || state.openPositionsCount === 0}
              style={{
                width: '100%',
                padding: `${spacing.sm}px ${spacing.lg}px`,
                backgroundColor:
                  state.openPositionsCount === 0 ? colors.surfaceElevated : colors.warningMuted,
                color: state.openPositionsCount === 0 ? colors.textMuted : colors.warning,
                border: `1px solid ${colors.warningBorder}`,
                borderRadius: borderRadius.md,
                fontWeight: typography.fontWeight.bold,
                cursor: state.openPositionsCount === 0 ? 'not-allowed' : 'pointer',
                fontSize: typography.fontSize.sm,
              }}
            >
              {isFlattening
                ? 'FLATTENING IN PROGRESS...'
                : state.openPositionsCount === 0
                ? 'NO OPEN POSITIONS TO FLATTEN'
                : '⚡ REQUEST FLATTEN ALL POSITIONS'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Flatten All */}
      {showFlattenModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.loss}`,
              borderRadius: borderRadius.lg,
              padding: spacing.xl,
              maxWidth: 520,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.md,
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: typography.fontSize.lg, color: colors.loss }}>
                Confirm Request Flatten All
              </h3>
            </div>

            <p style={{ margin: 0, color: colors.textPrimary, fontSize: typography.fontSize.sm, lineHeight: 1.5 }}>
              Are you sure you want to request an immediate market exit for all open positions?
            </p>

            <div
              style={{
                backgroundColor: colors.surfaceElevated,
                padding: spacing.md,
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                color: colors.textSecondary,
                lineHeight: 1.6,
              }}
            >
              <div>• <strong>Open Positions to Exit:</strong> {state.openPositionsCount}</div>
              <div>• <strong>Order Type:</strong> Market (Immediate Aggressive Exit)</div>
              <div>• <strong>Reservations:</strong> Settled to Available Cash</div>
              <div>• <strong>Engine Transition:</strong> DISARMED upon submission</div>
              <div style={{ color: colors.warning, marginTop: 4 }}>
                * Exits are sent to the broker; confirmed fill events finalize the closed state.
              </div>
            </div>

            <div>
              <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>
                OPERATOR AUDIT REASON
              </label>
              <input
                type="text"
                value={flattenReason}
                onChange={(e) => setFlattenReason(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: colors.surfaceElevated,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm,
                  padding: spacing.sm,
                  color: colors.textPrimary,
                  fontSize: typography.fontSize.xs,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end', marginTop: spacing.sm }}>
              <button
                onClick={() => setShowFlattenModal(false)}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  backgroundColor: colors.surfaceElevated,
                  color: colors.textSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.semibold,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFlatten}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  backgroundColor: colors.loss,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: typography.fontSize.xs,
                  fontWeight: typography.fontWeight.bold,
                }}
              >
                Confirm & Flatten All
              </button>
            </div>
          </div>
        </div>
      )}

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
        <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>
          Execution Mode & Session Arming
        </h3>
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
      <div
        style={{
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          padding: spacing.md,
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: typography.fontSize.md }}>
          Active Hard Risk Safeguards
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: typography.fontSize.xs,
            }}
          >
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
                <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                  Total Trading Capital
                </td>
                <td style={{ padding: spacing.sm, color: colors.cyan }}>₹10,000.00</td>
                <td style={{ padding: spacing.sm }}>
                  ₹{state.availableCash.toFixed(2)} Available
                </td>
                <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                  Central account-wide lock
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                  Max Per-Trade All-In Risk
                </td>
                <td style={{ padding: spacing.sm, color: colors.loss }}>₹500.00</td>
                <td style={{ padding: spacing.sm }}>₹270.70 Active</td>
                <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                  Loss + roundtrip fees + slippage
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                  Daily Drawdown Cap
                </td>
                <td style={{ padding: spacing.sm, color: colors.loss }}>₹1,500.00</td>
                <td style={{ padding: spacing.sm }}>₹0.00 / ₹1,500.00</td>
                <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                  Exceeding locks new entries
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                  Max Open Positions
                </td>
                <td style={{ padding: spacing.sm, color: colors.cyan }}>1 Position</td>
                <td style={{ padding: spacing.sm }}>
                  {state.openPositionsCount} / 1 Open
                </td>
                <td style={{ padding: spacing.sm, color: colors.textMuted }}>
                  Strict concurrency serial gate
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
