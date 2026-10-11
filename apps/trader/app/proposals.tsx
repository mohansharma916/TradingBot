import { useState, useEffect } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { AgentTask, ProposalStatus, TradeProposal } from '@trading-bot/contracts';
import { apiClient } from '../src/services/api';
import { formatErrorMessage } from '@trading-bot/client-sdk';
import { useWorkstation } from '../src/hooks/useWorkstation';

export default function ProposalsScreen() {
  const { state: workstation } = useWorkstation();
  const [activeTab, setActiveTab] = useState<'PROPOSALS' | 'AGENT_TASKS'>('PROPOSALS');
  const [pendingProposal, setPendingProposal] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clockTime, setClockTime] = useState(Date.now());

  const [proposals, setProposals] = useState<TradeProposal[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);

  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Sync proposals and tasks from live backend API
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const [props, taskList] = await Promise.all([
          apiClient.getPendingProposals(),
          apiClient.getAgentTasks(),
        ]);
        if (isMounted) {
          if (props) {
            setProposals(props);
            setIsLiveConnected(true);
          }
          if (taskList) {
            setTasks(taskList);
          }
        }
      } catch (failure) { if (isMounted) { setIsLiveConnected(false); setStatusMessage(formatErrorMessage(failure) || 'Proposals unavailable.'); } }
    };
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [workstation.mode]);

  useEffect(() => {
    const timer = setInterval(() => setClockTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const handleApprove = async (proposalId: string) => {
    if (pendingProposal) return; setPendingProposal(proposalId);
    try {
      const result = await apiClient.approveProposal(proposalId);
      if (!result.success) throw new Error('Proposal approval was not accepted.');
      setProposals(await apiClient.getPendingProposals());
      setStatusMessage(`Approval recorded. Intent ${result.intentId}; check the confirmed order ledger for execution and protection.`);
    } catch (failure) { setStatusMessage(formatErrorMessage(failure) || 'Approval was not confirmed.'); }
    finally { setPendingProposal(null); }
  };
  const handleReject = async (proposalId: string) => {
    if (pendingProposal) return; setPendingProposal(proposalId);
    try {
      const result = await apiClient.rejectProposal(proposalId, 'Rejected by owner in workstation');
      if (!result.success) throw new Error('Rejection was not accepted.');
      setProposals(await apiClient.getPendingProposals()); setStatusMessage('Proposal rejection recorded.');
    } catch (failure) { setStatusMessage(formatErrorMessage(failure) || 'Rejection was not confirmed.'); }
    finally { setPendingProposal(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
              Trade Proposals & Agent Workspace
            </h1>
            <Badge
              label={isLiveConnected ? 'API CONNECTED' : 'PROPOSALS UNAVAILABLE'}
              variant={isLiveConnected ? 'success' : 'purple'}
              size="sm"
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Specialized tool-restricted agents propose structured trades. Deterministic risk gates enforce account safety.
          </p>
        </div>

        {/* Tab Selector */}
        <div style={{ display: 'flex', gap: spacing.xs, backgroundColor: colors.surface, padding: 4, borderRadius: borderRadius.sm, border: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setActiveTab('PROPOSALS')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'PROPOSALS' ? colors.cyan : 'transparent',
              color: activeTab === 'PROPOSALS' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            📋 Proposals Inspector ({proposals.filter((p) => p.status === ProposalStatus.PENDING).length})
          </button>
          <button
            onClick={() => setActiveTab('AGENT_TASKS')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'AGENT_TASKS' ? colors.cyan : 'transparent',
              color: activeTab === 'AGENT_TASKS' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            🤖 Agent Task Board ({tasks.length})
          </button>
        </div>
      </div>

      {/* Security Barrier Notification */}
      <div
        style={{
          padding: spacing.md,
          backgroundColor: 'rgba(30, 41, 59, 0.7)',
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <Badge label="INVARIANT ENFORCED" variant="primary" />
        <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
          🔒 Agents have <strong>ZERO direct broker write access</strong>. They can only execute registered read-only analytical tools (<code style={{ color: colors.cyan }}>scan_universe</code>, <code style={{ color: colors.cyan }}>calculate_indicators</code>, <code style={{ color: colors.cyan }}>evaluate_strategy</code>). Orders require explicit owner approval or armed session state.
        </span>
      </div>

      {/* Status Feedback Toast */}
      {statusMessage && (
        <div
          style={{
            padding: spacing.md,
            backgroundColor: 'rgba(6, 182, 212, 0.12)',
            border: `1px solid ${colors.cyan}`,
            borderRadius: borderRadius.md,
            color: colors.cyan,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: Proposals Inspector */}
      {activeTab === 'PROPOSALS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
          {proposals.length === 0 ? (
            <div
              style={{
                backgroundColor: colors.surface,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                padding: spacing.xl,
                textAlign: 'center',
                color: colors.textMuted,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: spacing.sm }}>🎯</div>
              <div style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.semibold, color: colors.textPrimary }}>
                No Pending Trade Proposals
              </div>
              <div style={{ fontSize: typography.fontSize.xs, marginTop: 4 }}>
                Proposals appear after the backend confirms available market data, strategy rules, and account risk checks.
              </div>
            </div>
          ) : (
            proposals.map((proposal) => {
            const secondsRemaining = Math.max(0, Math.ceil((Date.parse(proposal.expiresAt) - clockTime) / 1000));
            const isPending = proposal.status === ProposalStatus.PENDING && secondsRemaining > 0;
            const isExpired = secondsRemaining === 0 && proposal.status === ProposalStatus.PENDING;

            return (
              <div
                key={proposal.id}
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
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                      <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>
                        {proposal.symbol} ({proposal.side})
                      </h2>
                      <Badge label={proposal.proposingAgent} variant="primary" />
                      {isPending && (
                        <Badge label={`⏱️ EXPIRES IN ${formatTimer(secondsRemaining)}`} variant="warning" />
                      )}
                      {isExpired && <Badge label="EXPIRED (TTL)" variant="danger" />}
                      {proposal.status === ProposalStatus.APPROVED && <Badge label="AUTHORIZED" variant="success" />}
                      {proposal.status === ProposalStatus.REJECTED && <Badge label="REJECTED" variant="neutral" />}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 4 }}>
                      Strategy: {proposal.strategyId} v{proposal.strategyVersion} | Selected account: {workstation.mode === 'PAPER' ? 'Testing' : 'Live'} | Lot: {proposal.lotSize}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>HEURISTIC SCORE</div>
                    <div style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colors.cyan }}>
                      {((proposal.evidence.confidence ?? 0) * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Sizing & Financial Gate Breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing.md }}>
                  <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>ENTRY PRICE (LIMIT)</div>
                    <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, fontFamily: typography.fontFamily.mono }}>
                      ₹{proposal.suggestedEntryPrice.toFixed(2)}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Qty: {proposal.quantity} ({proposal.quantity / proposal.lotSize} Lots)</div>
                  </div>

                  <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>STOP LOSS</div>
                    <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, fontFamily: typography.fontFamily.mono }}>
                      ₹{proposal.suggestedStopPrice.toFixed(2)}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Gross Loss: ₹{((proposal.suggestedEntryPrice - proposal.suggestedStopPrice) * proposal.quantity).toFixed(2)}</div>
                  </div>

                  <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROFIT TARGET</div>
                    <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.profit, fontFamily: typography.fontFamily.mono }}>
                      ₹{proposal.suggestedTargetPrice.toFixed(2)}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Net Gain: ₹{proposal.estimatedNetProfit.toFixed(2)}</div>
                  </div>

                  <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>ESTIMATED ALL-IN RISK</div>
                    <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, fontFamily: typography.fontFamily.mono }}>
                      ₹{proposal.allInMaxLoss.toFixed(2)}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Incl. ₹{proposal.estimatedRoundTripCosts.toFixed(2)} charges</div>
                  </div>
                </div>

                {/* AI Agent Evidence & Objective Data */}
                <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                  <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginBottom: spacing.xs }}>
                    REPORTED STRATEGY EVIDENCE
                  </div>
                  <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.8 }}>
                    <div>{proposal.evidence.rationale}</div>
                    {Object.entries(proposal.evidence.indicators).map(([name, value]) => (
                      <div key={name}><strong>{name}:</strong> {String(value)}</div>
                    ))}
                    {Object.keys(proposal.evidence.indicators).length === 0 && <div>No indicator values were supplied.</div>}
                    <div>The heuristic score is a rule assessment, not a calibrated probability of profit.</div>
                  </div>
                </div>

                {/* Action Buttons */}
                {isPending && (
                  <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      disabled={!!pendingProposal} onClick={() => handleReject(proposal.id)}
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
                      disabled={!!pendingProposal} onClick={() => handleApprove(proposal.id)}
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
            );
          }))}
        </div>
      )}

      {/* TAB 2: Agent Task Board */}
      {activeTab === 'AGENT_TASKS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {tasks.length === 0 ? (
            <div
              style={{
                backgroundColor: colors.surface,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                padding: spacing.xl,
                textAlign: 'center',
                color: colors.textMuted,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: spacing.sm }}>🤖</div>
              <div style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.semibold, color: colors.textPrimary }}>
                No Agent Tasks Recorded Today
              </div>
              <div style={{ fontSize: typography.fontSize.xs, marginTop: 4 }}>
                Autonomous task dispatches, market scans, and analytical tool trails will appear here.
              </div>
            </div>
          ) : (
            tasks.map((task) => (
            <div
              key={task.id}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                  <Badge label={task.agentType} variant="primary" />
                  <span style={{ fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                    {task.objective}
                  </span>
                </div>
                <Badge label={task.status} variant="success" />
              </div>

              {/* Tool Execution Trail */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.textSecondary, marginBottom: spacing.xs }}>
                  READ-ONLY TOOLS INVOKED ({task.toolsInvoked.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
                  {task.toolsInvoked.map((t, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: typography.fontSize.xs,
                        fontFamily: typography.fontFamily.mono,
                        color: colors.textSecondary,
                        display: 'flex',
                        gap: spacing.sm,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: colors.cyan }}>✓ {t.tool}()</span>
                      <span style={{ color: colors.textMuted }}>({t.timestamp.split('T')[1]?.split('.')[0]} IST)</span>
                      <span style={{ color: colors.textMuted }}>Output: {JSON.stringify(t.output)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Task Result Summary */}
              <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                <strong>Result:</strong> {task.resultSummary}
              </div>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
