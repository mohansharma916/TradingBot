import { useState } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';

export default function ProposalsScreen() {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDecided, setIsDecided] = useState(false);

  const handleApprove = () => {
    setIsDecided(true);
    setStatusMessage('Trade Proposal Approved. Revalidating risk and dispatching order intent...');
  };

  const handleReject = () => {
    setIsDecided(true);
    setStatusMessage('Trade Proposal Rejected by Owner.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
          Trade Proposals & Agent Tasks
        </h1>
        <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
          Specialized agents propose structured trades. Deterministic risk engine and owner authorization gate execution.
        </p>
      </div>

      {statusMessage && (
        <div
          style={{
            padding: spacing.md,
            backgroundColor: 'rgba(6, 182, 212, 0.15)',
            border: `1px solid ${colors.cyan}`,
            borderRadius: borderRadius.md,
            color: colors.cyan,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Trade Proposal Inspector Card */}
      <div
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: spacing.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.lg,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>NIFTY26OCT25100CE (BUY Long Call)</h2>
              <Badge label="STRATEGY ANALYST" variant="primary" />
              <Badge label="EXPIRING IN 2m 45s" variant="warning" />
            </div>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 4 }}>
              Strategy: NIFTY EMA20 RSI Long Call v1 | Mode: PAPER
            </div>
          </div>

          <Badge label={isDecided ? 'PROCESSED' : 'PENDING APPROVAL'} variant={isDecided ? 'neutral' : 'warning'} />
        </div>

        {/* Pricing & Financial Gate Breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing.md }}>
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>ENTRY PRICE</div>
            <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, fontFamily: typography.fontFamily.mono }}>
              ₹122.50
            </div>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Qty: 25 (1 Lot)</div>
          </div>

          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>STOP LOSS</div>
            <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, fontFamily: typography.fontFamily.mono }}>
              ₹114.00
            </div>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Gross Loss: ₹212.50</div>
          </div>

          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROFIT TARGET</div>
            <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.profit, fontFamily: typography.fontFamily.mono }}>
              ₹136.00
            </div>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Gross Gain: ₹337.50</div>
          </div>

          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>ALL-IN RISK (CAP ₹500)</div>
            <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, fontFamily: typography.fontFamily.mono }}>
              ₹270.70
            </div>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Incl. ₹58.20 fees & slippage</div>
          </div>
        </div>

        {/* AI Agent Evidence & Objective Data */}
        <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
          <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginBottom: spacing.xs }}>
            OBJECTIVE AGENT EVIDENCE (CONFIDENCE: 78%)
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
            • 5-Minute EMA(20): 25,115.00 (Crossed above at 09:45:00 IST candle close)<br />
            • RSI(14): 58.40 (Positive momentum confirmation &gt; 55)<br />
            • VWAP: 25,102.50 (Price trading comfortably above session VWAP)<br />
            • Bid/Ask Spread: ₹0.30 (0.24% of premium — highly liquid contract)
          </div>
        </div>

        {/* Action Buttons */}
        {!isDecided && (
          <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              onClick={handleReject}
              style={{
                padding: `${spacing.sm}px ${spacing.xl}px`,
                borderRadius: borderRadius.md,
                backgroundColor: colors.surfaceElevated,
                color: colors.loss,
                border: `1px solid ${colors.lossBorder}`,
                fontWeight: typography.fontWeight.semibold,
                cursor: 'pointer',
                fontSize: typography.fontSize.sm,
              }}
            >
              Reject Proposal
            </button>
            <button
              onClick={handleApprove}
              style={{
                padding: `${spacing.sm}px ${spacing.xl}px`,
                borderRadius: borderRadius.md,
                backgroundColor: colors.profit,
                color: '#FFFFFF',
                border: 'none',
                fontWeight: typography.fontWeight.bold,
                cursor: 'pointer',
                fontSize: typography.fontSize.sm,
              }}
            >
              Authorize Trade Proposal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
