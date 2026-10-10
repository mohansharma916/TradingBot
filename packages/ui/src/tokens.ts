/**
 * Design Tokens for AI-Assisted F&O Workstation
 * Dark-first institutional aesthetic with high-contrast accessibility.
 */

export const colors = {
  background: '#090D16',
  surface: '#111827',
  surfaceElevated: '#1F2937',
  surfaceSubtle: '#151D2F',
  border: '#1E293B',
  borderHover: '#334155',
  borderActive: '#06B6D4',

  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  brand: '#3B82F6',
  cyan: '#06B6D4',
  purple: '#8B5CF6',

  profit: '#10B981',
  profitMuted: 'rgba(16, 185, 129, 0.15)',
  profitBorder: 'rgba(16, 185, 129, 0.3)',

  loss: '#EF4444',
  lossMuted: 'rgba(239, 68, 68, 0.15)',
  lossBorder: 'rgba(239, 68, 68, 0.3)',

  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.15)',
  warningBorder: 'rgba(245, 158, 11, 0.3)',

  paper: '#6366F1',
  paperMuted: 'rgba(99, 102, 241, 0.15)',

  overlay: 'rgba(0, 0, 0, 0.75)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const typography = {
  fontSize: {
    xs: 11,
    sm: 13,
    base: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    stat: 28,
  },
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    mono: '500' as const,
  },
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
};
