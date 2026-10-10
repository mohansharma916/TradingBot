import React from 'react';
import { colors, spacing, borderRadius, typography } from '../tokens';
import { TradeMode, RiskState } from '@trading-bot/contracts';

export interface RiskBannerProps {
  mode: TradeMode;
  riskState: RiskState;
  egressIpVerified: boolean;
  onEmergencyStop?: () => void;
}

export const RiskBanner: React.FC<RiskBannerProps> = ({
  mode,
  riskState,
  egressIpVerified,
  onEmergencyStop,
}) => {
  const isArmed = riskState === RiskState.ARMED;
  const isEmergency = riskState === RiskState.EMERGENCY_STOP || riskState === RiskState.FROZEN;

  const getRiskBg = () => {
    if (isEmergency) return colors.lossMuted;
    if (isArmed) return colors.warningMuted;
    return colors.surfaceSubtle;
  };

  const getRiskBorder = () => {
    if (isEmergency) return colors.lossBorder;
    if (isArmed) return colors.warningBorder;
    return colors.border;
  };

  return (
    <div
      role="banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.md,
        padding: `${spacing.sm}px ${spacing.lg}px`,
        backgroundColor: getRiskBg(),
        borderBottom: `1px solid ${getRiskBorder()}`,
        fontFamily: typography.fontFamily.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
        {/* Mode Pill */}
        <span
          style={{
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: borderRadius.sm,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.bold,
            backgroundColor: mode === TradeMode.PAPER ? colors.paperMuted : colors.cyan,
            color: mode === TradeMode.PAPER ? '#A5B4FC' : '#082F49',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          MODE: {mode}
        </span>

        {/* Risk State */}
        <span
          style={{
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: borderRadius.sm,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.semibold,
            backgroundColor: isArmed ? colors.warningMuted : colors.surfaceElevated,
            color: isArmed ? colors.warning : colors.textSecondary,
          }}
        >
          RISK: {riskState}
        </span>

        {/* Egress IP */}
        <span
          style={{
            fontSize: typography.fontSize.xs,
            color: egressIpVerified ? colors.profit : colors.warning,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: egressIpVerified ? colors.profit : colors.warning,
            }}
          />
          {egressIpVerified ? 'EGRESS IP VERIFIED' : 'EGRESS IP UNVERIFIED'}
        </span>
      </div>

      {onEmergencyStop && (
        <button
          type="button"
          onClick={onEmergencyStop}
          style={{
            backgroundColor: colors.loss,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: borderRadius.sm,
            padding: `${spacing.xs}px ${spacing.md}px`,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.bold,
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          EMERGENCY FREEZE
        </button>
      )}
    </div>
  );
};
