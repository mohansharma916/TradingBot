import { useState, useEffect, useCallback } from 'react';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { StatCard, Badge } from '@trading-bot/ui';
import { RiskStatus, DailyReport, Position, DiagnosticsReport } from '@trading-bot/contracts';
import { isMarketOpenForTrading } from '@trading-bot/domain';
import { apiClient } from '../src/services/api';
import { useWorkstation } from '../src/hooks/useWorkstation';
import { tradingDateInIst } from '../src/features/daily-bot/config';

export default function DashboardScreen() {
  const { state: workstation } = useWorkstation();
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const [risk, setRisk] = useState<RiskStatus>({
    mode: 'PAPER' as any,
    state: 'DISARMED' as any,
    totalCapital: 0,
    availableCash: 0,
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
    egressIpVerified: false,
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
        apiClient.getRiskStatus(),
        apiClient.getDailyReport(),
        apiClient.getPositions(),
        apiClient.getDiagnostics(),
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
    setIsLiveConnected(false);
    void fetchLiveDashboard();
    if (!isMarketOpenForTrading()) {
      return;
    }
    const interval = setInterval(fetchLiveDashboard, 4000);
    return () => clearInterval(interval);
  }, [fetchLiveDashboard, workstation.mode]);

  const netPnl = report?.realizedNetPnl ?? risk?.realizedNetDailyPnl ?? 0;
  const targetProfit = risk?.dailyTargetProfit ?? 0;
  const progressPct = targetProfit > 0 ? Math.max(0, Math.min(100, (netPnl / targetProfit) * 100)) : 0;

  if (!isLiveConnected) return <div role="alert" style={{ color: colors.textSecondary }}>Dashboard data unavailable. Waiting for confirmed account and report responses.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xl, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Workstation Dashboard
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Confirmed {workstation.mode === 'PAPER' ? 'virtual testing' : 'live account'} portfolio and risk limits.
            {lastSyncTime && <span style={{ marginLeft: 8, color: colors.cyan }}>• Synced {lastSyncTime}</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge
            label={isLiveConnected ? 'API CONNECTED' : 'ACCOUNT DATA UNAVAILABLE'}
            variant={isLiveConnected ? 'success' : 'purple'}
          />
          <Badge
            label={diagnostics?.brokerConnection?.authenticated ? 'UPSTOX AUTHENTICATED' : 'UPSTOX NOT AUTHENTICATED'}
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
          value={`₹${(risk?.totalCapital ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={workstation.mode === 'PAPER' ? 'Virtual testing capital' : 'Verified broker capital'}
        />
        <StatCard
          label="Available Cash"
          value={`₹${(risk?.availableCash ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`₹${(risk?.reservedCapital ?? 0).toFixed(2)} reserved for trading`}
        />
        <StatCard
          label={workstation.mode === 'PAPER' ? 'Virtual Realized Net P&L' : report.chargesSource === 'BROKER_CONFIRMED' ? 'Realized Net P&L' : 'Realized Net P&L (estimated fees)'}
          value={`${netPnl >= 0 ? '+' : ''}₹${netPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`${report.chargesSource ?? 'ESTIMATED'} fees: ₹${(report?.actualCharges ?? 0).toFixed(2)} | ${report?.totalTrades ?? 0} trades`}
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
            🎯 Informational Daily Goal: ₹{targetProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
              No recorded open positions. Available cash: ₹{(risk?.availableCash ?? 0).toFixed(2)}.
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
            <h3 style={{ margin: 0, fontSize: typography.fontSize.md }}>Recorded System State</h3>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
              Account capital: ₹{(risk?.totalCapital ?? 0).toLocaleString('en-IN')}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {[
              {
                name: 'Market Scanner',
                status: diagnostics?.marketFeed?.connected ? `Feed connected (${diagnostics.marketFeed.latencyMs}ms latency)` : 'Market feed unavailable',
                state: diagnostics?.marketFeed?.connected ? 'CONNECTED' : 'UNAVAILABLE',
              },
              { name: 'Strategy Rules', status: 'Defined in the registered strategy configuration', state: 'CONFIGURATION' },
              {
                name: 'Risk Reviewer',
                status: risk?.killSwitchActive ? 'Kill Switch Tripped - Engine Frozen' : `Validating all-in max ₹${risk?.maxAllInTradeLoss ?? 500} loss`,
                state: risk?.state || 'UNAVAILABLE',
              },
              {
                name: 'Position Monitor',
                status: positions.length > 0 ? `${positions.length} recorded positions; check Orders for protection status` : 'No recorded positions',
                state: positions.length > 0 ? 'EXPOSURE' : 'NO EXPOSURE',
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
