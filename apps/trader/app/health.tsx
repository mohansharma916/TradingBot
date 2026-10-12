import { useState, useEffect } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import {
  UpstoxSessionStatus,
  ReconciliationReport,
  SystemAlert,
  AlertSeverity,
  DiagnosticsReport,
  ReconciliationScheduleStatus,
  TradeMode,
  RiskState,
} from '@trading-bot/contracts';
import { apiClient } from '../src/services/api';
import { formatErrorMessage } from '@trading-bot/client-sdk';

export default function HealthScreen() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Upstox OAuth Session State
  const [session, setSession] = useState<UpstoxSessionStatus>({
    isConnected: false,
    isExpired: false,
    tokenExpiresAt: null,
    secondsRemaining: 0,
    egressIpVerified: false,
    registeredEgressIp: '',
    currentEgressIp: '',
    rateLimitRemaining: 0,
    lastReconciledAt: null,
  });

  // Reconciliation Audit State
  const [reconciliation, setReconciliation] = useState<ReconciliationReport>({
    timestamp: new Date().toISOString(),
    status: 'CLEAN',
    brokerPositionsCount: 0,
    localPositionsCount: 0,
    brokerOrdersCount: 0,
    localOrdersCount: 0,
    discrepancies: [],
    executionFrozen: false,
  });

  // Automated Reconciliation Scheduler State
  const [schedulerStatus, setSchedulerStatus] = useState<ReconciliationScheduleStatus>({
    schedulerActive: false,
    intervalSeconds: 60,
    lastRunAt: null,
    totalRuns: 0,
    lastDiscrepanciesFound: 0,
  });

  // Diagnostics Telemetry State
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport>({
    uptimeSeconds: 0,
    memoryUsageMb: 0,
    systemMode: TradeMode.PAPER,
    marketFeed: {
      connected: false,
      latencyMs: 0,
      staleTicksCount: 0,
      lastTickAt: null,
    },
    brokerConnection: {
      authenticated: false,
      rateLimiterTokensRemaining: 0,
      egressIpMatch: false,
      registeredIp: '',
      tokenExpiresInSeconds: 0,
    },
    riskStatus: {
      killSwitchActive: false,
      riskState: RiskState.DISARMED,
      availableCash: 0,
      reservedCapital: 0,
      dailyDrawdownBudgetRemaining: 1500.0,
      openPositionsCount: 0,
    },
    reconciliation: {
      activeScheduler: false,
      lastReconciliationAt: null,
      discrepancyCount: 0,
    },
    timestamp: new Date().toISOString(),
  });

  // System Alerts Queue
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleConnectOAuth = async () => {
    try {
      const res = await apiClient.connectUpstox();
      if (res?.authUrl) {
        showToast('Redirecting to Upstox OAuth login...');
        if (typeof window !== 'undefined') {
          window.location.href = res.authUrl;
        }
      } else {
        throw new Error('The API did not supply an Upstox authorization URL.');
      }
    } catch (err: any) {
      showToast(`OAuth connection error: ${formatErrorMessage(err) || 'Check API connection'}`);
    }
  };

  // Periodic sync with live backend API & handle OAuth redirect query params
  useEffect(() => {
    let isMounted = true;

    // Support direct frontend redirects (e.g. http://localhost:8081/health?code=...&state=...)
    if (typeof window !== 'undefined' && window.location.search) {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      if (code && state) {
        showToast('Processing Upstox OAuth callback...');
        apiClient
          .exchangeUpstoxCallback(code, state)
          .then((res) => {
            if (res.success && isMounted) {
              showToast('✓ Upstox broker connected successfully!');
              window.history.replaceState({}, document.title, window.location.pathname);
              syncHealth();
            }
          })
          .catch((err) => {
            if (isMounted) {
              showToast(`OAuth exchange failed: ${formatErrorMessage(err) || 'Invalid or expired state'}`);
            }
          });
      }
    }

    const syncHealth = async () => {
      try {
        const [diag, sess, recon, sched, alertList] = await Promise.all([
          apiClient.getDiagnostics(),
          apiClient.getUpstoxSession(),
          apiClient.getReconciliationReport(),
          apiClient.getReconciliationSchedule(),
          apiClient.getAlerts(),
        ]);
        if (isMounted) {
          if (diag) setDiagnostics(diag);
          if (sess) setSession(sess);
          if (recon) setReconciliation(recon);
          if (sched) setSchedulerStatus(sched);
          if (alertList) setAlerts(alertList);
          setIsLiveConnected(true);
        }
      } catch (failure) { if (isMounted) { setIsLiveConnected(false); showToast(formatErrorMessage(failure) || 'Health data unavailable.'); } }
    };
    syncHealth();
    const interval = setInterval(syncHealth, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDisconnect = async () => {
    try {
      const result = await apiClient.disconnectUpstox();
      if (!result.success) throw new Error(result.message);
      setSession(await apiClient.getUpstoxSession()); showToast(result.message);
    } catch (failure) { showToast(formatErrorMessage(failure) || 'Disconnect was not confirmed.'); }
  };
  const handleRunReconciliation = async () => {
    try { const result = await apiClient.triggerReconciliation(); setReconciliation(result); showToast(`Reconciliation returned ${result.discrepancies.length} discrepancies.`); }
    catch (failure) { showToast(formatErrorMessage(failure) || 'Reconciliation was not confirmed.'); }
  };
  const handleTriggerIncidentDrill = async () => {
    try {
      const alert = await apiClient.triggerDrillAlert({ title: 'Incident Recovery Drill Alert', message: 'Operator-requested notification delivery drill.' });
      setAlerts((items) => [alert, ...items]); showToast('Test alert recorded by the API.');
    } catch (failure) { showToast(formatErrorMessage(failure) || 'Test alert delivery was not confirmed.'); }
  };
  const handleAcknowledgeAlert = async (id: string) => {
    try {
      const result = await apiClient.acknowledgeAlert(id);
      setAlerts((items) => items.map((item) => item.id === id ? result : item)); showToast('Alert acknowledgement recorded.');
    } catch (failure) { showToast(formatErrorMessage(failure) || 'Acknowledgement was not confirmed.'); }
  };
  const toggleScheduler = async () => {
    try {
      const result = schedulerStatus.schedulerActive ? await apiClient.stopReconciliationSchedule() : await apiClient.startReconciliationSchedule(60);
      setSchedulerStatus(result); showToast(result.schedulerActive ? 'Reconciliation scheduler started.' : 'Reconciliation scheduler paused.');
    } catch (failure) { showToast(formatErrorMessage(failure) || 'Scheduler change was not confirmed.'); }
  };

  const hoursRemaining = Math.floor(session.secondsRemaining / 3600);
  const minutesRemaining = Math.floor((session.secondsRemaining % 3600) / 60);

  if (!isLiveConnected) return <div role="alert" style={{ color: colors.textSecondary }}>Health data unavailable. {toastMessage || "Waiting for the trading API."}</div>;

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
            <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
              Broker Health & Diagnostics
            </h1>
            <Badge
              label={isLiveConnected ? 'API CONNECTED' : 'ACCOUNT DATA UNAVAILABLE'}
              variant={isLiveConnected ? 'success' : 'purple'}
              size="sm"
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Upstox OAuth 2.0 status, background reconciliation scheduler, and real-time operational telemetry.
          </p>
        </div>
      </div>

      {/* Diagnostics Telemetry Metrics Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: spacing.md,
        }}
      >
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>WS FEED LATENCY</div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.profit, marginTop: 4 }}>
            {diagnostics.marketFeed.lastTickAt ? `${diagnostics.marketFeed.latencyMs} ms` : 'Unavailable'}
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            {diagnostics.marketFeed.connected ? 'Feed connected' : 'Feed disconnected or unavailable'}
          </div>
        </div>

        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>STALE TICKS COUNT</div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: diagnostics.marketFeed.staleTicksCount > 0 ? colors.loss : colors.profit, marginTop: 4 }}>
            {diagnostics.marketFeed.staleTicksCount}
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            3,000ms stale threshold
          </div>
        </div>

        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>HEAP MEMORY USAGE</div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginTop: 4 }}>
            {diagnostics.memoryUsageMb} MB
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            Node.js process memory
          </div>
        </div>

        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.md }}>
          <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>RECONCILIATION SCHEDULER</div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: schedulerStatus.schedulerActive ? colors.profit : colors.warning, marginTop: 4 }}>
            {schedulerStatus.schedulerActive ? `ACTIVE (${schedulerStatus.intervalSeconds}s)` : 'PAUSED'}
          </div>
          <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 4 }}>
            Total audits: {schedulerStatus.totalRuns}
          </div>
        </div>
      </div>

      {/* Main Grid: OAuth Session & Reconciliation */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: spacing.lg }}>
        {/* Card 1: Upstox OAuth Session Status */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.lg, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: typography.fontSize.md }}>Upstox OAuth 2.0 Session</h2>
            <Badge
              label={session.isConnected && !session.isExpired ? 'CONNECTED' : 'DISCONNECTED'}
              variant={session.isConnected && !session.isExpired ? 'success' : 'danger'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs, fontSize: typography.fontSize.xs }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Token Status:</span>
              <span style={{ fontWeight: typography.fontWeight.semibold, color: session.isExpired ? colors.loss : colors.profit }}>
                {session.isConnected && !session.isExpired ? 'Token locally valid' : 'Expired or unavailable'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Time Until Expiry:</span>
              <span style={{ fontWeight: typography.fontWeight.semibold, color: session.secondsRemaining < 3600 ? colors.warning : colors.textPrimary }}>
                {session.tokenExpiresAt ? `${hoursRemaining}h ${minutesRemaining}m` : 'N/A'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Egress IP Binding:</span>
              <span style={{ fontWeight: typography.fontWeight.semibold, color: session.egressIpVerified ? colors.profit : colors.loss }}>
                {session.egressIpVerified ? `${session.currentEgressIp} · Verified` : 'Not measured'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0` }}>
              <span style={{ color: colors.textMuted }}>Rate Limiter Pool:</span>
              <span style={{ fontWeight: typography.fontWeight.semibold, color: colors.cyan }}>
                Not measured
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.xs }}>
            <button
              onClick={handleConnectOAuth}
              style={{
                flex: 1,
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.cyan,
                color: '#082F49',
                border: 'none',
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.bold,
                cursor: 'pointer',
              }}
            >
              Reconnect Upstox
            </button>
            <button
              onClick={handleDisconnect}
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.surfaceElevated,
                color: colors.loss,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.semibold,
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          </div>
        </div>

        {/* Card 2: Periodic Reconciliation Scheduler */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.lg, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: typography.fontSize.md }}>Automated Reconciliation Audit</h2>
            <Badge
              label={reconciliation.status === 'CLEAN' ? 'LEDGER IN SYNC' : 'DISCREPANCY'}
              variant={reconciliation.status === 'CLEAN' ? 'success' : 'danger'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs, fontSize: typography.fontSize.xs }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Positions Sync:</span>
              <span>Broker: {reconciliation.brokerPositionsCount} | Local: {reconciliation.localPositionsCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Orders Sync:</span>
              <span>Broker: {reconciliation.brokerOrdersCount} | Local: {reconciliation.localOrdersCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted }}>Last Run Timestamp:</span>
              <span style={{ color: colors.textSecondary }}>{new Date(reconciliation.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0` }}>
              <span style={{ color: colors.textMuted }}>Auto-Scheduler Status:</span>
              <span style={{ color: schedulerStatus.schedulerActive ? colors.profit : colors.warning, fontWeight: 'bold' }}>
                {schedulerStatus.schedulerActive ? `Enabled (Every ${schedulerStatus.intervalSeconds}s)` : 'Stopped'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.xs }}>
            <button
              onClick={handleRunReconciliation}
              style={{
                flex: 1,
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.surfaceElevated,
                color: colors.textPrimary,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.semibold,
                cursor: 'pointer',
              }}
            >
              Run Audit Now
            </button>
            <button
              onClick={toggleScheduler}
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.surfaceElevated,
                color: schedulerStatus.schedulerActive ? colors.warning : colors.profit,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.semibold,
                cursor: 'pointer',
              }}
            >
              {schedulerStatus.schedulerActive ? 'Pause Schedule' : 'Start Schedule'}
            </button>
          </div>
        </div>
      </div>

      {/* Discrepancy Details Table (if any) */}
      {reconciliation.discrepancies.length > 0 && (
        <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.loss}`, overflowX: 'auto', padding: spacing.md }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: typography.fontSize.sm, color: colors.loss }}>
            Active Reconciliation Discrepancies
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
            <thead>
              <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                <th style={{ padding: spacing.sm }}>TYPE</th>
                <th style={{ padding: spacing.sm }}>INSTRUMENT</th>
                <th style={{ padding: spacing.sm }}>BROKER VALUE</th>
                <th style={{ padding: spacing.sm }}>LOCAL VALUE</th>
                <th style={{ padding: spacing.sm }}>SEVERITY</th>
                <th style={{ padding: spacing.sm }}>ACTION TAKEN</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.discrepancies.map((d, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold, color: colors.warning }}>
                    {d.type}
                  </td>
                  <td style={{ padding: spacing.sm }}>{d.instrumentKey}</td>
                  <td style={{ padding: spacing.sm }}>{JSON.stringify(d.brokerValue)}</td>
                  <td style={{ padding: spacing.sm, color: colors.textMuted }}>{d.localValue ? JSON.stringify(d.localValue) : 'None'}</td>
                  <td style={{ padding: spacing.sm }}>
                    <Badge label={d.severity} variant="danger" size="sm" />
                  </td>
                  <td style={{ padding: spacing.sm, color: colors.loss }}>{d.actionTaken}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Incident Drill & System Alerts Center */}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <div>
            <h2 style={{ margin: 0, fontSize: typography.fontSize.md }}>
              In-App System Alerts
            </h2>
            <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
              Alerts recorded by the API and sent through the in-app notification channel.
            </p>
          </div>

          <button
            onClick={handleTriggerIncidentDrill}
            style={{
              padding: `${spacing.sm}px ${spacing.lg}px`,
              backgroundColor: colors.lossMuted,
              color: colors.loss,
              border: `1px solid ${colors.loss}`,
              borderRadius: borderRadius.sm,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.bold,
              cursor: 'pointer',
            }}
          >
            🔥 TRIGGER INCIDENT DRILL
          </button>
        </div>

        {/* Alerts List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          {alerts.length === 0 ? (
            <div
              style={{
                padding: spacing.md,
                backgroundColor: colors.surfaceElevated,
                borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`,
                color: colors.textMuted,
                fontSize: typography.fontSize.sm,
                textAlign: 'center',
              }}
            >
              No recorded system alerts. Check diagnostics for subsystem status.
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  backgroundColor: alert.acknowledged ? colors.surfaceElevated : colors.surface,
                  border: `1px solid ${
                    alert.severity === AlertSeverity.EMERGENCY || alert.severity === AlertSeverity.CRITICAL
                      ? colors.loss
                      : alert.severity === AlertSeverity.WARNING
                      ? colors.warningBorder
                      : colors.border
                  }`,
                  borderRadius: borderRadius.sm,
                  padding: spacing.md,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 260 }}>
                  <Badge
                    label={alert.severity}
                    variant={
                      alert.severity === AlertSeverity.EMERGENCY || alert.severity === AlertSeverity.CRITICAL
                        ? 'danger'
                        : alert.severity === AlertSeverity.WARNING
                        ? 'warning'
                        : 'neutral'
                    }
                    size="sm"
                  />
                <div>
                  <div style={{ fontWeight: typography.fontWeight.bold, fontSize: typography.fontSize.xs, color: colors.textPrimary }}>
                    {alert.title}
                  </div>
                  <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 2 }}>
                    {alert.message}
                  </div>
                  <div style={{ color: colors.textMuted, fontSize: '10px', marginTop: 4 }}>
                    {new Date(alert.timestamp).toLocaleTimeString()} • Category: {alert.category}
                  </div>
                </div>
              </div>

              <div>
                {alert.acknowledged ? (
                  <span style={{ fontSize: typography.fontSize.xs, color: colors.profit, fontWeight: typography.fontWeight.semibold }}>
                    ✓ Acknowledged
                  </span>
                ) : (
                  <button
                    onClick={() => handleAcknowledgeAlert(alert.id)}
                    style={{
                      padding: `${spacing.xs}px ${spacing.sm}px`,
                      backgroundColor: colors.surfaceElevated,
                      color: colors.textPrimary,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.sm,
                      fontSize: typography.fontSize.xs,
                      cursor: 'pointer',
                      fontWeight: typography.fontWeight.semibold,
                    }}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          )))}
        </div>
      </div>
    </div>
  );
}
