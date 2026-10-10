import React from 'react';
import { colors, spacing, borderRadius, typography } from '../tokens';

export interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'profit' | 'loss' | 'neutral';
  infoTooltip?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subValue,
  trend = 'neutral',
}) => {
  const getTrendColor = () => {
    if (trend === 'profit') return colors.profit;
    if (trend === 'loss') return colors.loss;
    return colors.textPrimary;
  };

  return (
    <div
      style={{
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.xs,
        minWidth: 160,
        flex: 1,
      }}
    >
      <div
        style={{
          fontSize: typography.fontSize.xs,
          color: colors.textMuted,
          fontWeight: typography.fontWeight.medium,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: typography.fontSize.xxl,
          fontWeight: typography.fontWeight.bold,
          color: getTrendColor(),
          fontFamily: typography.fontFamily.mono,
        }}
      >
        {value}
      </div>

      {subValue && (
        <div
          style={{
            fontSize: typography.fontSize.xs,
            color: colors.textSecondary,
          }}
        >
          {subValue}
        </div>
      )}
    </div>
  );
};
