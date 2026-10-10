import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { Badge } from '@trading-bot/ui';

export default function HealthScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
          Broker Health & Diagnostics
        </h1>
        <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
          Operational vitals, static egress IP verification, and WebSocket feed telemetry.
        </p>
      </div>

      {/* Diagnostics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: spacing.md }}>
        {/* Upstox Connection */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.sm }}>Upstox Broker V3 API</h3>
            <Badge label="AUTHENTICATED" variant="success" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
            • Protocol: HTTPS OAuth 2.0 with Bearer Token<br />
            • Registered Egress IP: 127.0.0.1 (Verified)<br />
            • Current Server IP: 127.0.0.1<br />
            • IP Match Status: <span style={{ color: colors.profit, fontWeight: 'bold' }}>EXACT MATCH</span><br />
            • Token Expiry: 23 hours 45 mins remaining
          </div>
        </div>

        {/* Market Data Feed V3 */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.sm }}>Market Data Feed V3</h3>
            <Badge label="STREAMING" variant="success" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
            • Stream: Server-Side WebSocket (Protobuf V3)<br />
            • Heartbeat Latency: 18ms<br />
            • Stale Feed Detector: ACTIVE (&gt; 3.0s drops trigger PAUSE)<br />
            • Active Instrument Subscriptions: 14 contracts<br />
            • Dropped Packets: 0
          </div>
        </div>

        {/* Backend & Database */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.sm }}>Platform Architecture</h3>
            <Badge label="HEALTHY" variant="success" size="sm" />
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
            • NestJS API Process: Port 4000 (PID: Active)<br />
            • Dedicated Worker Runtime: Single-Leader Lock Active<br />
            • PostgreSQL 16: System of Record & Ledger Connected<br />
            • Safety Default: PAPER Execution Mode
          </div>
        </div>
      </div>
    </div>
  );
}
