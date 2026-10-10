import React from 'react';
import { colors, spacing, borderRadius, typography } from '../tokens';

export interface BadgeProps {
  label: string;
  variant?: 'primary' | 'success' | 'danger' | 'warning' | 'neutral' | 'purple';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral', size = 'sm' }) => {
  const getColors = () => {
    switch (variant) {
      case 'success':
        return { bg: colors.profitMuted, text: colors.profit, border: colors.profitBorder };
      case 'danger':
        return { bg: colors.lossMuted, text: colors.loss, border: colors.lossBorder };
      case 'warning':
        return { bg: colors.warningMuted, text: colors.warning, border: colors.warningBorder };
      case 'primary':
        return { bg: 'rgba(59, 130, 246, 0.15)', text: '#60A5FA', border: 'rgba(59, 130, 246, 0.3)' };
      case 'purple':
        return { bg: colors.paperMuted, text: '#A5B4FC', border: 'rgba(99, 102, 241, 0.3)' };
      default:
        return { bg: colors.surfaceElevated, text: colors.textSecondary, border: colors.border };
    }
  };

  const c = getColors();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? `2px ${spacing.sm}px` : `${spacing.xs}px ${spacing.md}px`,
        borderRadius: borderRadius.sm,
        fontSize: size === 'sm' ? typography.fontSize.xs : typography.fontSize.sm,
        fontWeight: typography.fontWeight.medium,
        backgroundColor: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </span>
  );
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  style,
  disabled,
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'secondary':
        return {
          backgroundColor: colors.surfaceElevated,
          color: colors.textPrimary,
          border: `1px solid ${colors.border}`,
        };
      case 'danger':
        return {
          backgroundColor: colors.loss,
          color: '#FFFFFF',
          border: 'none',
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          color: colors.cyan,
          border: `1px solid ${colors.cyan}`,
        };
      default:
        return {
          backgroundColor: colors.brand,
          color: '#FFFFFF',
          border: 'none',
        };
    }
  };

  const getSizePadding = () => {
    switch (size) {
      case 'sm':
        return `${spacing.xs}px ${spacing.sm}px`;
      case 'lg':
        return `${spacing.md}px ${spacing.xl}px`;
      default:
        return `${spacing.sm}px ${spacing.md}px`;
    }
  };

  return (
    <button
      disabled={disabled}
      style={{
        ...getVariantStyles(),
        padding: getSizePadding(),
        borderRadius: borderRadius.md,
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.semibold,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease-in-out',
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
};
