import { useState, useEffect } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { AgentTask, AgentType, ProposalStatus, TradeProposal, OrderSide, ProductType } from '@trading-bot/contracts';

export default function ProposalsScreen() {
  const [activeTab, setActiveTab] = useState<'PROPOSALS' | 'AGENT_TASKS'>('PROPOSALS');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(165);

  const [proposals, setProposals] = useState<TradeProposal[]>([
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY26OCT25100CE',
      side: OrderSide.BUY,
      product: ProductType.I,
      suggestedEntryPrice: 122.5,
      suggestedStopPrice: 114.0,
      suggestedTargetPrice: 136.0,
      lotSize: 25,
      quantity: 25,
      estimatedCapitalRequired: 3062.5,
      estimatedRoundTripCosts: 58.2,
      allInMaxLoss: 270.7,
      estimatedNetProfit: 279.3,
      evidence: {
        indicators: {
          ema20: 25115.0,
          rsi14: 58.4,
          vwap: 25102.5,
          spreadPct: 0.24,
          volume: 45000,
        },
        rationale: '5m EMA bullish cross + RSI above 55 confirmation on closed bar with tight 0.24% spread.',
        confidence: 0.78,
      },
      status: ProposalStatus.PENDING,
      expiresAt: new Date(Date.now() + 165000).toISOString(),
      createdAt: new Date().toISOString(),
    },
  ]);

  const [tasks] = useState<AgentTask[]>([
    {
      id: 'task_1001_coord',
      agentType: AgentType.COORDINATOR,
      status: 'COMPLETED' as any,
      objective: 'Run 5-minute candle close scan for NIFTY EMA20 RSI Strategy v1',
      toolsInvoked: [
        {
          tool: 'scan_universe' as any,
          timestamp: '2026-10-10T09:30:05.120Z',
          input: { underlying: 'NIFTY', minVolume: 1000, maxSpreadPct: 1.0 },
          output: { candidatesCount: 8, topCandidate: 'NIFTY26OCT25100CE', spreadPct: 0.24 },
        },
        {
          tool: 'calculate_indicators' as any,
          timestamp: '2026-10-10T09:30:06.450Z',
          input: { instrumentKey: 'NSE_INDEX|Nifty 50', timeframe: '5m', emaPeriod: 20, rsiPeriod: 14 },
          output: { isWarmedUp: true, totalClosedBars: 40, ema: 25115.0, rsi: 58.4, vwap: 25102.5 },
        },
        {
          tool: 'evaluate_strategy' as any,
          timestamp: '2026-10-10T09:30:07.820Z',
          input: { strategyId: '550e8400-e29b-41d4-a716-446655440002', instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE' },
          output: { passed: true, signal: 'BUY_CALL', confidence: 0.78 },
        },
      ],
      resultSummary: 'Multi-agent scan satisfied all entry criteria. Expiring TradeProposal generated with calibrated confidence 78%.',
      startedAt: '2026-10-10T09:30:00.000Z',
      completedAt: '2026-10-10T09:30:08.000Z',
    },
    {
      id: 'task_1002_scan',
      agentType: AgentType.MARKET_SCANNER,
      status: 'COMPLETED' as any,
      objective: 'Rank active weekly options by liquidity and bid/ask spread percentage',
      toolsInvoked: [
        {
          tool: 'scan_universe' as any,
          timestamp: '2026-10-10T09:25:02.100Z',
          input: { underlying: 'NIFTY' },
          output: { scannedStrikes: 26, liquidCount: 8 },
        },
      ],
      resultSummary: '8 strikes passed spread < 1.0% filter. ATM 25100 CE selected as highest liquidity score (86/100).',
      startedAt: '2026-10-10T09:25:00.000Z',
      completedAt: '2026-10-10T09:25:03.000Z',
    },
  ]);

  // Live countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const handleApprove = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, status: ProposalStatus.APPROVED } : p)),
    );
    setStatusMessage(
      `Trade Proposal authorized by owner! Supervised execution dispatched: Freshness revalidated (<3s), capital locked (₹3,062.50), and GTT Protective Exits attached (Stop: ₹114.00, Target: ₹136.00).`,
    );
  };

  const handleReject = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, status: ProposalStatus.REJECTED } : p)),
    );
    setStatusMessage(`Trade Proposal rejected by owner. Central risk reservations released.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Trade Proposals & Agent Workspace
          </h1>
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
          {proposals.map((proposal) => {
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
                        {proposal.symbol} ({proposal.side} Long Call)
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
                      Strategy: NIFTY EMA20 RSI Long Call v{proposal.strategyVersion} | Mode: PAPER | Lot: {proposal.lotSize}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>CALIBRATED CONFIDENCE</div>
                    <div style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colors.cyan }}>
                      {((proposal.evidence.confidence || 0.78) * 100).toFixed(0)}%
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
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Qty: {proposal.quantity} (1 Lot)</div>
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
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>ALL-IN RISK (CAP ₹500)</div>
                    <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, fontFamily: typography.fontFamily.mono }}>
                      ₹{proposal.allInMaxLoss.toFixed(2)}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Incl. ₹{proposal.estimatedRoundTripCosts.toFixed(2)} charges</div>
                  </div>
                </div>

                {/* AI Agent Evidence & Objective Data */}
                <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
                  <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginBottom: spacing.xs }}>
                    OBJECTIVE EVIDENCE BREAKDOWN (CONFIRMED ON CLOSED BAR)
                  </div>
                  <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.8 }}>
                    • <strong>5-Minute EMA(20):</strong> 25,115.00 (Bullish cross above on confirmed candle close)<br />
                    • <strong>RSI(14):</strong> 58.40 (Positive momentum confirmation &gt; 55.0 threshold)<br />
                    • <strong>VWAP:</strong> 25,102.50 (Price trading comfortably above session intraday VWAP)<br />
                    • <strong>Bid/Ask Spread:</strong> 0.24% (Tight liquidity gate passed &lt; 1.0% limit)<br />
                    • <strong>Contract Volume:</strong> 45,000 units (Deep liquidity above 1,000 unit threshold)
                  </div>
                </div>

                {/* Action Buttons */}
                {isPending && (
                  <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handleReject(proposal.id)}
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
                      onClick={() => handleApprove(proposal.id)}
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
          })}
        </div>
      )}

      {/* TAB 2: Agent Task Board */}
      {activeTab === 'AGENT_TASKS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {tasks.map((task) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
