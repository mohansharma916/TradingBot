import { useState, useEffect, useCallback } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { StatCard, Badge } from '@trading-bot/ui';
import { RiskStatus, DailyReport, Position, DiagnosticsReport } from '@trading-bot/contracts';
import { apiClient } from '../src/services/api';
import { tradingDateInIst } from '../src/features/daily-bot/config';

export default function DashboardScreen() {
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const [risk, setRisk] = useState<RiskStatus>({
    mode: 'PAPER' as any,
    state: 'DISARMED' as any,
    totalCapital: 10000,
    availableCash: 10000,
    reservedCapital: 0,
    maxAllInTradeLoss: 500,
    dailyLossCap: 1500,
    realizedNetDailyPnl: 0,
    unrealizedDailyPnl: 0,
    remainingDailyRiskBudget: 1500,
    openPositionsCount: 0,
    maxOpenPositions: 1,
    dailyTargetProfit: 4000,
    armedUntil: null,
    killSwitchActive: false,
    egressIpVerified: true,
  });

  const [report, setReport] = useState<DailyReport>({
    tradingDay: tradingDateInIst(),
    mode: 'PAPER' as any,
    realizedGrossPnl: 0,
    estimatedCharges: 0,
    actualCharges: 0,
    realizedNetPnl: 0,
    unrealizedPnl: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    maxDrawdown: 0,
    capitalDeployed: 0,
  });

  const [positions, setPositions] = useState<Position[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null);

  const fetchLiveDashboard = useCallback(async () => {
    try {
      const [riskData, reportData, posData, diagData] = await Promise.all([
        apiClient.getRiskStatus().catch(() => null),
        apiClient.getDailyReport().catch(() => null),
        apiClient.getPositions().catch(() => []),
        apiClient.getDiagnostics().catch(() => null),
      ]);

      if (riskData) {
        setRisk(riskData);
        setIsLiveConnected(true);
        setLastSyncTime(new Date().toLocaleTimeString());
      }
      if (reportData) setReport(reportData);
      if (posData) setPositions(posData);
      if (diagData) setDiagnostics(diagData);
    } catch {
      setIsLiveConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveDashboard();
    const interval = setInterval(fetchLiveDashboard, 4000);
    return () => clearInterval(interval);
  }, [fetchLiveDashboard]);

  const netPnl = report?.realizedNetPnl ?? risk?.realizedNetDailyPnl ?? 0;
  const targetProfit = risk?.dailyTargetProfit ?? 4000;
  const progressPct = Math.max(0, Math.min(100, (netPnl / targetProfit) * 100));

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
            {lastSyncTime && <span style={{ marginLeft: 8, color: colors.cyan }}>• Synced {lastSyncTime}</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge
            label={isLiveConnected ? '🟢 LIVE API SYNCED' : '⚠️ OFFLINE / PAPER SIMULATION'}
            variant={isLiveConnected ? 'success' : 'purple'}
          />
          <Badge
            label={diagnostics?.brokerConnection?.authenticated ? 'UPSTOX CONNECTED' : 'UPSTOX READY (V3)'}
            variant={diagnostics?.brokerConnection?.authenticated ? 'success' : 'primary'}
          />
          <Badge
            label={`MODE: ${risk?.mode || 'PAPER'}`}
            variant="purple"
          />
        </div>
      </div>

      {/* Financial Stat Widgets Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: spacing.md }}>
        <StatCard
          label="Total Capital"
          value={`₹${(risk?.totalCapital ?? 10000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue="Account-wide hard cap"
        />
        <StatCard
          label="Available Cash"
          value={`₹${(risk?.availableCash ?? 10000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`₹${((risk?.totalCapital ?? 10000) - (risk?.availableCash ?? 10000)).toFixed(2)} in margin & buffer`}
        />
        <StatCard
          label="Realized Net P&L"
          value={`${netPnl >= 0 ? '+' : ''}₹${netPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`After ₹${(report?.actualCharges ?? 0).toFixed(2)} fees | ${report?.totalTrades ?? 0} trades`}
          trend={netPnl >= 0 ? 'profit' : 'loss'}
        />
        <StatCard
          label="Max Per-Trade Risk"
          value={`₹${(risk?.maxAllInTradeLoss ?? 500).toFixed(2)}`}
          subValue={`Daily Cap: ₹${(risk?.dailyLossCap ?? 1500).toFixed(2)}`}
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
            🎯 Informational Daily Goal: ₹{targetProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (40% Milestone)
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
            Progress: ₹{netPnl.toFixed(2)} / ₹{targetProfit.toFixed(2)} ({progressPct.toFixed(1)}%)
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ width: '100%', height: 8, backgroundColor: colors.surfaceElevated, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(2, progressPct)}%`, height: '100%', backgroundColor: colors.profit, borderRadius: 4 }} />
        </div>

        <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 4 }}>
          <strong>Safety Invariant:</strong> This daily profit target is strictly informational. It will never force a trade, increase risk limits, or bypass the ₹{(risk?.dailyLossCap ?? 1500).toFixed(2)} daily drawdown cap.
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
            <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>
              Active F&O Positions ({positions.length} / {risk?.maxOpenPositions ?? 1} Max)
            </h3>
            {positions.length > 0 && <Badge label="PROTECTED (GTT)" variant="primary" />}
          </div>

          {positions.length === 0 ? (
            <div style={{ padding: spacing.md, textAlign: 'center', color: colors.textMuted, fontSize: typography.fontSize.sm }}>
              Zero open positions. Capital fully preserved in cash (₹{(risk?.availableCash ?? 10000).toFixed(2)}).
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              {positions.map((pos) => {
                const pnl = pos.unrealizedPnl ?? 0;
                return (
                  <div
                    key={pos.id || pos.instrumentKey}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: spacing.xs,
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      borderRadius: borderRadius.sm,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.sm }}>
                      <span style={{ fontWeight: typography.fontWeight.semibold }}>{pos.symbol}</span>
                      <span style={{ color: pnl >= 0 ? colors.profit : colors.loss, fontWeight: typography.fontWeight.bold }}>
                        {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                      <span>Qty: {pos.netQuantity} | Avg: ₹{(pos.buyAvgPrice ?? 0).toFixed(2)}</span>
                      <span>LTP: ₹{(pos.lastPrice ?? 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: typography.fontSize.xs, color: colors.textMuted, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.xs }}>
                      <span>Stop: ₹{(pos.stopLossPrice ?? 0).toFixed(2)}</span>
                      <span>Target: ₹{(pos.targetPrice ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
              Shared ₹{(risk?.totalCapital ?? 10000).toLocaleString('en-IN')} Budget
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {[
              {
                name: 'Market Scanner',
                status: diagnostics?.marketFeed?.connected ? `Feed active (${diagnostics.marketFeed.latencyMs}ms latency)` : 'Scanning liquid NIFTY strikes',
                state: diagnostics?.marketFeed?.connected ? 'STREAMING' : 'ACTIVE',
              },
              { name: 'Strategy Analyst', status: '5m EMA & RSI confirmation filter', state: 'ACTIVE' },
              {
                name: 'Risk Reviewer',
                status: risk?.killSwitchActive ? 'Kill Switch Tripped - Engine Frozen' : `Validating all-in max ₹${risk?.maxAllInTradeLoss ?? 500} loss`,
                state: risk?.state || 'ARMED',
              },
              {
                name: 'Position Monitor',
                status: positions.length > 0 ? `Monitoring ${positions.length} position with GTT exits` : 'Awaiting entry fills',
                state: positions.length > 0 ? 'MONITORING' : 'IDLE',
              },
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
                <Badge
                  label={agent.state}
                  variant={agent.state === 'EMERGENCY_STOP' ? 'danger' : agent.state === 'IDLE' ? 'neutral' : 'success'}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
