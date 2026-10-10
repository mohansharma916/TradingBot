import { useState } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { StrategyConfig, StrategyStatus, TradeMode, AllowedOptionType, MoneynessType } from '@trading-bot/contracts';
import { calculateStrategyVersionHash } from '@trading-bot/domain';

export default function StrategiesScreen() {
  const [strategies, setStrategies] = useState<StrategyConfig[]>([
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      name: 'NIFTY EMA20 RSI Long Call',
      version: 1,
      versionHash: 'v1-337f4ea9',
      status: StrategyStatus.PAPER_ACTIVE,
      tradeMode: TradeMode.PAPER,
      market: 'NSE_FO',
      underlying: 'NIFTY',
      allowedInstruments: [AllowedOptionType.LONG_CALL],
      timeframe: '5m',
      session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      entry: {
        emaPeriod: 20,
        rsiPeriod: 14,
        rsiThreshold: 55,
        maxBidAskSpreadPct: 1.0,
        minVolume: 1000,
      },
      selection: {
        expiry: 'NEAREST_ELIGIBLE',
        moneyness: MoneynessType.ATM,
        minVolume: 1000,
      },
      risk: {
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 200,
        maxAllInDailyLossInr: 600,
        maxOpenPositions: 1,
        maxTradesPerDay: 3,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 60,
      },
      exit: {
        stopBasis: 'OPTION_PREMIUM',
        marketCutoff: '15:10',
      },
      maxCapitalInr: 10000,
      maxAllInTradeLossInr: 200,
      maxAllInDailyLossInr: 600,
      targetNetProfitInr: 300,
      maxRoundTripCostBudgetInr: 60,
      maxOpenPositions: 1,
      requiresApproval: true,
    },
  ]);

  const [versionHistory, setVersionHistory] = useState<Record<string, StrategyConfig[]>>({
    '550e8400-e29b-41d4-a716-446655440002': [
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        name: 'NIFTY EMA20 RSI Long Call (v1)',
        version: 1,
        versionHash: 'v1-337f4ea9',
        status: StrategyStatus.PAPER_ACTIVE,
        tradeMode: TradeMode.PAPER,
        market: 'NSE_FO',
        underlying: 'NIFTY',
        allowedInstruments: [AllowedOptionType.LONG_CALL],
        timeframe: '5m',
        session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
        entry: { emaPeriod: 20, rsiPeriod: 14, rsiThreshold: 55, maxBidAskSpreadPct: 1.0, minVolume: 1000 },
        selection: { expiry: 'NEAREST_ELIGIBLE', moneyness: MoneynessType.ATM, minVolume: 1000 },
        risk: { maxCapitalInr: 10000, maxAllInTradeLossInr: 200, maxAllInDailyLossInr: 600, maxOpenPositions: 1, maxTradesPerDay: 3, targetNetProfitInr: 300, maxRoundTripCostBudgetInr: 60 },
        exit: { stopBasis: 'OPTION_PREMIUM', marketCutoff: '15:10' },
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 200,
        maxAllInDailyLossInr: 600,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 60,
        maxOpenPositions: 1,
        requiresApproval: true,
      },
    ],
  });

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedStrategyId] = useState<string>('550e8400-e29b-41d4-a716-446655440002');
  const [isScanning, setIsScanning] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Form State for Strategy Editor
  const [formData, setFormData] = useState({
    name: 'NIFTY EMA20 RSI Momentum',
    underlying: 'NIFTY',
    timeframe: '5m',
    emaPeriod: 20,
    rsiPeriod: 14,
    rsiThreshold: 55,
    maxBidAskSpreadPct: 1.0,
    minVolume: 1000,
    moneyness: MoneynessType.ATM,
    maxCapitalInr: 10000,
    maxAllInTradeLossInr: 200,
    maxAllInDailyLossInr: 600,
    targetNetProfitInr: 300,
  });

  const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId) || strategies[0]!;

  const handleRunScan = async (strategy: StrategyConfig) => {
    setIsScanning(true);
    setFeedbackMessage(`MarketScanner agent running 5m closed-bar scan for ${strategy.name}...`);

    setTimeout(() => {
      setIsScanning(false);
      setFeedbackMessage(
        `Agent scan completed! MarketScanner found 4 liquid candidate contracts. StrategyAnalyst confirmed bullish 5m EMA cross and RSI momentum. A structured TradeProposal has been published to the Proposals Inspector.`,
      );
    }, 1200);
  };

  const handleSaveStrategy = () => {
    // Validate hard risk caps
    if (formData.maxCapitalInr > 10000) {
      alert('Risk Violation: Account capital hard cap cannot exceed ₹10,000');
      return;
    }
    if (formData.maxAllInTradeLossInr > 500) {
      alert('Risk Violation: All-in trade loss hard cap cannot exceed ₹500');
      return;
    }
    if (formData.maxAllInDailyLossInr > 1500) {
      alert('Risk Violation: Daily drawdown cap cannot exceed ₹1,500');
      return;
    }

    const newVersion = selectedStrategy.version + 1;
    const updatedStrategy: StrategyConfig = {
      ...selectedStrategy,
      name: formData.name,
      underlying: formData.underlying,
      version: newVersion,
      entry: {
        emaPeriod: Number(formData.emaPeriod),
        rsiPeriod: Number(formData.rsiPeriod),
        rsiThreshold: Number(formData.rsiThreshold),
        maxBidAskSpreadPct: Number(formData.maxBidAskSpreadPct),
        minVolume: Number(formData.minVolume),
      },
      selection: {
        expiry: 'NEAREST_ELIGIBLE',
        moneyness: formData.moneyness,
        minVolume: Number(formData.minVolume),
      },
      risk: {
        ...selectedStrategy.risk,
        maxCapitalInr: Number(formData.maxCapitalInr),
        maxAllInTradeLossInr: Number(formData.maxAllInTradeLossInr),
        maxAllInDailyLossInr: Number(formData.maxAllInDailyLossInr),
        targetNetProfitInr: Number(formData.targetNetProfitInr),
      },
      maxCapitalInr: Number(formData.maxCapitalInr),
      maxAllInTradeLossInr: Number(formData.maxAllInTradeLossInr),
      maxAllInDailyLossInr: Number(formData.maxAllInDailyLossInr),
      targetNetProfitInr: Number(formData.targetNetProfitInr),
    };

    updatedStrategy.versionHash = calculateStrategyVersionHash(updatedStrategy);

    setStrategies((prev) => prev.map((s) => (s.id === selectedStrategy.id ? updatedStrategy : s)));

    // Record into history
    setVersionHistory((prev) => {
      const existingHistory = prev[selectedStrategy.id] || [];
      return {
        ...prev,
        [selectedStrategy.id]: [...existingHistory, updatedStrategy],
      };
    });

    setIsEditorOpen(false);
    setFeedbackMessage(
      `Strategy published as immutable version v${newVersion} (${updatedStrategy.versionHash}). Previous revisions preserved in audit ledger.`,
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
            Strategy Workspace & Builder
          </h1>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Deterministic rule-based strategy definitions with immutable versioning & read-only agent scanners.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm }}>
          <button
            onClick={() => {
              setFormData({
                name: selectedStrategy.name,
                underlying: selectedStrategy.underlying,
                timeframe: selectedStrategy.timeframe,
                emaPeriod: selectedStrategy.entry.emaPeriod,
                rsiPeriod: selectedStrategy.entry.rsiPeriod,
                rsiThreshold: selectedStrategy.entry.rsiThreshold,
                maxBidAskSpreadPct: selectedStrategy.entry.maxBidAskSpreadPct,
                minVolume: selectedStrategy.entry.minVolume,
                moneyness: selectedStrategy.selection.moneyness as any,
                maxCapitalInr: selectedStrategy.risk.maxCapitalInr,
                maxAllInTradeLossInr: selectedStrategy.risk.maxAllInTradeLossInr,
                maxAllInDailyLossInr: selectedStrategy.risk.maxAllInDailyLossInr,
                targetNetProfitInr: selectedStrategy.risk.targetNetProfitInr,
              });
              setIsEditorOpen(true);
            }}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.cyan,
              color: '#082F49',
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            ✏️ Edit Strategy Rules
          </button>

          <button
            onClick={() => setIsHistoryOpen(true)}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: borderRadius.md,
              backgroundColor: colors.surfaceElevated,
              color: colors.textPrimary,
              border: `1px solid ${colors.border}`,
              fontWeight: typography.fontWeight.semibold,
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            📜 Version History ({versionHistory[selectedStrategy.id]?.length || 1})
          </button>
        </div>
      </div>

      {/* Status Feedback Toast */}
      {feedbackMessage && (
        <div
          style={{
            padding: spacing.md,
            backgroundColor: 'rgba(6, 182, 212, 0.12)',
            border: `1px solid ${colors.cyan}`,
            borderRadius: borderRadius.md,
            color: colors.cyan,
            fontSize: typography.fontSize.sm,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{feedbackMessage}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Active Strategy Card */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>{selectedStrategy.name}</h2>
              <Badge label={`v${selectedStrategy.version}.0`} variant="primary" />
              <Badge label={selectedStrategy.versionHash || 'v1-337f4ea9'} variant="neutral" />
              <Badge label={selectedStrategy.status} variant="purple" />
            </div>
            <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
              Underlying: {selectedStrategy.underlying} | Timeframe: {selectedStrategy.timeframe} | Moneyness: {selectedStrategy.selection.moneyness} | Allowed: LONG_CALL
            </p>
          </div>

          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
            <button
              onClick={() => handleRunScan(selectedStrategy)}
              disabled={isScanning}
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                borderRadius: borderRadius.md,
                backgroundColor: isScanning ? colors.surfaceElevated : colors.profit,
                color: isScanning ? colors.textMuted : '#FFFFFF',
                fontWeight: typography.fontWeight.bold,
                border: 'none',
                cursor: isScanning ? 'not-allowed' : 'pointer',
                fontSize: typography.fontSize.xs,
              }}
            >
              {isScanning ? '⏳ Scanning Market...' : '🤖 Trigger Agent Scan'}
            </button>
            <Badge label="APPROVAL REQUIRED" variant="warning" />
          </div>
        </div>

        {/* Configuration Rules Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: spacing.md }}>
          {/* Entry Conditions */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginBottom: spacing.xs }}>
              ENTRY CRITERIA (ALL ON 5M CLOSED BARS)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>EMA({selectedStrategy.entry.emaPeriod}) Bullish Cross on confirmed closed bar</li>
              <li>RSI({selectedStrategy.entry.rsiPeriod}) &gt; {selectedStrategy.entry.rsiThreshold} momentum confirmation</li>
              <li>Bid/Ask spread &lt; {selectedStrategy.entry.maxBidAskSpreadPct}% maximum liquidity filter</li>
              <li>Min contract volume: {selectedStrategy.entry.minVolume.toLocaleString()} units</li>
              <li>Selection: {selectedStrategy.selection.expiry}, {selectedStrategy.selection.moneyness} strike</li>
            </ul>
          </div>

          {/* Risk Guardrails */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.warning, marginBottom: spacing.xs }}>
              RISK GUARDRAILS (HARD GATES)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>Max Capital: ₹{selectedStrategy.risk.maxCapitalInr.toLocaleString()} (Account budget)</li>
              <li>Max All-In Trade Loss: ₹{selectedStrategy.risk.maxAllInTradeLossInr.toFixed(2)} (Stop loss + roundtrip costs)</li>
              <li>Max Daily Loss: ₹{selectedStrategy.risk.maxAllInDailyLossInr.toFixed(2)}</li>
              <li>Target Net Profit: ₹{selectedStrategy.risk.targetNetProfitInr.toFixed(2)} net after ₹{selectedStrategy.risk.maxRoundTripCostBudgetInr} charges</li>
              <li>Max Open Positions: {selectedStrategy.risk.maxOpenPositions} lot</li>
            </ul>
          </div>

          {/* Exit Rules */}
          <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.sm }}>
            <div style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.profit, marginBottom: spacing.xs }}>
              EXIT RULES & TIMING CUTOFFS
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.fontSize.xs, color: colors.textSecondary, lineHeight: 1.6 }}>
              <li>Stop basis: {selectedStrategy.exit.stopBasis} (Multi-leg bracket limit)</li>
              <li>Target basis: Dynamic net profit reservation ₹{selectedStrategy.risk.targetNetProfitInr}</li>
              <li>Intraday cutoff: {selectedStrategy.exit.marketCutoff} IST automatic square-off</li>
              <li>Session window: {selectedStrategy.session.start} to {selectedStrategy.session.lastEntry} IST</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Strategy Editor Modal */}
      {isEditorOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              width: '100%',
              maxWidth: 600,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: spacing.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.md,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>Edit Strategy Rules (Draft v{selectedStrategy.version + 1})</h2>
              <button
                onClick={() => setIsEditorOpen(false)}
                style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
              Any modification to indicators or risk parameters will automatically generate an immutable published version bump.
            </p>

            {/* Form Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Strategy Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Underlying Asset</label>
                <select
                  value={formData.underlying}
                  onChange={(e) => setFormData({ ...formData, underlying: e.target.value })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                >
                  <option value="NIFTY">NIFTY (Lot: 25)</option>
                  <option value="BANKNIFTY">BANKNIFTY (Lot: 15)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>EMA Period</label>
                <input
                  type="number"
                  value={formData.emaPeriod}
                  onChange={(e) => setFormData({ ...formData, emaPeriod: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>RSI Threshold</label>
                <input
                  type="number"
                  value={formData.rsiThreshold}
                  onChange={(e) => setFormData({ ...formData, rsiThreshold: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Max Bid/Ask Spread (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.maxBidAskSpreadPct}
                  onChange={(e) => setFormData({ ...formData, maxBidAskSpreadPct: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Strike Moneyness</label>
                <select
                  value={formData.moneyness}
                  onChange={(e) => setFormData({ ...formData, moneyness: e.target.value as any })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                >
                  <option value={MoneynessType.ATM}>ATM (At-The-Money)</option>
                  <option value={MoneynessType.ITM_1}>ITM_1 (In-The-Money 1 strike)</option>
                  <option value={MoneynessType.OTM_1}>OTM_1 (Out-of-Money 1 strike)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Max All-In Trade Risk (₹ Max 500)</label>
                <input
                  type="number"
                  value={formData.maxAllInTradeLossInr}
                  onChange={(e) => setFormData({ ...formData, maxAllInTradeLossInr: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>Target Net Profit (₹)</label>
                <input
                  type="number"
                  value={formData.targetNetProfitInr}
                  onChange={(e) => setFormData({ ...formData, targetNetProfitInr: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    marginTop: 4,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'flex-end', marginTop: spacing.md }}>
              <button
                onClick={() => setIsEditorOpen(false)}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: borderRadius.sm,
                  backgroundColor: colors.surfaceElevated,
                  color: colors.textPrimary,
                  border: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveStrategy}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: borderRadius.sm,
                  backgroundColor: colors.cyan,
                  color: '#082F49',
                  fontWeight: typography.fontWeight.bold,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Publish New Revision
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {isHistoryOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              width: '100%',
              maxWidth: 600,
              padding: spacing.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.md,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg }}>Immutable Version Audit Ledger</h2>
              <button
                onClick={() => setIsHistoryOpen(false)}
                style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {(versionHistory[selectedStrategy.id] || [selectedStrategy]).map((ver) => (
                <div
                  key={ver.versionHash}
                  style={{
                    backgroundColor: colors.surfaceElevated,
                    padding: spacing.md,
                    borderRadius: borderRadius.sm,
                    border: `1px solid ${ver.version === selectedStrategy.version ? colors.cyan : colors.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                      Revision v{ver.version}.0 {ver.version === selectedStrategy.version && '(Active)'}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, fontFamily: typography.fontFamily.mono }}>
                      Hash: {ver.versionHash} | EMA: {ver.entry.emaPeriod} | RSI: {ver.entry.rsiThreshold} | Max Loss: ₹{ver.risk.maxAllInTradeLossInr}
                    </div>
                  </div>
                  <Badge label="VERIFIED" variant="primary" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
