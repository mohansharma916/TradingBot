import { describe, it, expect } from 'vitest';
import { colors, typography, spacing } from '../tokens.ts';

describe('UI Design Tokens', () => {
  it('has institutional dark theme color tokens defined', () => {
    expect(colors.background).toBe('#090D16');
    expect(colors.profit).toBe('#10B981');
    expect(colors.loss).toBe('#EF4444');
    expect(colors.cyan).toBe('#06B6D4');
  });

  it('defines structured spacing and typography', () => {
    expect(spacing.md).toBe(12);
    expect(typography.fontSize.base).toBe(14);
    expect(typography.fontWeight.bold).toBe('700');
  });
});
