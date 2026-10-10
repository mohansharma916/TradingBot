import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import {
  StrategyConfig,
  StrategyStatus,
  TradeMode,
  AllowedOptionType,
  MoneynessType,
  BacktestResult,
} from '@trading-bot/contracts';
import { apiClient } from '../src/services/api';
import {
  loadSavedDraft,
  saveDraftToStorage,
  createDailyBotDraft,
  tradingDateInIst,
  StoredDailyBotDraft,
} from '../src/features/daily-bot/config';

export default function StrategiesScreen() {
  const router = useRouter();
  const backtestRef = useRef<HTMLDivElement>(null);

  // Daily Bot continuity state
  const [dailyDraft, setDailyDraft] = useState<StoredDailyBotDraft | null>(null);

  // Strategy list & active selection
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Backtest state
  const [backtestDays, setBacktestDays] = useState<number>(14);
  const [backtestCapital, setBacktestCapital] = useState<number>(10000);
  const [backtestUnderlying, setBacktestUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [historyList, setHistoryList] = useState<StrategyConfig[]>([]);

  // Create Strategy Form
  const [createForm, setCreateForm] = useState({
    name: '',
    underlying: 'NIFTY' as 'NIFTY' | 'BANKNIFTY',
    direction: AllowedOptionType.LONG_CALL,
    timeframe: '5m',
    emaPeriod: 20,
    rsiPeriod: 14,
    rsiThreshold: 55,
    maxCapitalInr: 10000,
    maxAllInTradeLossInr: 200,
    targetNetProfitInr: 300,
    maxTradesPerDay: 3,
  });

  // Edit Strategy Form
  const [editForm, setEditForm] = useState({
    name: '',
    emaPeriod: 20,
    rsiPeriod: 14,
    rsiThreshold: 55,
    maxCapitalInr: 10000,
    maxAllInTradeLossInr: 200,
    targetNetProfitInr: 300,
    maxTradesPerDay: 3,
  });

  // Check saved Daily Bot draft
  useEffect(() => {
    const todayStr = tradingDateInIst();
    const stored = loadSavedDraft(todayStr);
    if (stored) {
      setDailyDraft(stored);
    }
  }, []);

  // Fetch strategies from backend API
  const loadStrategies = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getStrategies();
      if (data && data.length > 0) {
        setStrategies(data);
        if (!selectedStrategyId || !data.some((s) => s.id === selectedStrategyId)) {
          setSelectedStrategyId(data[0]!.id);
          setBacktestUnderlying((data[0]!.underlying as 'NIFTY' | 'BANKNIFTY') || 'NIFTY');
        }
      }
    } catch (err: any) {
      setFeedback({ message: `Failed to load strategies: ${err.message}`, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  const activeStrategy = strategies.find((s) => s.id === selectedStrategyId) || strategies[0];

  // Helper to flash notifications
  const showFeedback = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setFeedback({ message: msg, type });
    setTimeout(() => setFeedback(null), 6000);
  };

  // Select strategy for Daily Bot
  const handleUseInDailyBot = (strategy: StrategyConfig) => {
    const todayStr = tradingDateInIst();
    let currentStored = loadSavedDraft(todayStr);

    if (currentStored && currentStored.draft) {
      // Update strategy in draft
      currentStored.draft.strategyId = strategy.id;
      currentStored.draft.dailyCapitalBudget = String(strategy.risk?.maxCapitalInr ?? 10000);
      currentStored.draft.maxCapitalPerTrade = String(strategy.risk?.maxCapitalInr ?? 10000);
      currentStored.draft.perTradeMaxLossAllIn = String(strategy.risk?.maxAllInTradeLossInr ?? 200);
      currentStored.draft.dailyMaxLossAllIn = String(strategy.risk?.maxAllInDailyLossInr ?? 600);
      saveDraftToStorage(todayStr, currentStored.draft, currentStored.step, currentStored.savedSetupId);
    } else {
      // Create new draft with this strategy
      const freshDraft = createDailyBotDraft(todayStr, strategy);
      saveDraftToStorage(todayStr, freshDraft, 0, null);
    }

    showFeedback(`Strategy "${strategy.name}" selected! Navigating to Daily Bot...`, 'success');
    setTimeout(() => {
      router.push('/');
    }, 600);
  };

  // Run backtest
  const handleRunBacktest = async (strategyToTest?: StrategyConfig) => {
    const strat = strategyToTest || activeStrategy;
    if (!strat) return;

    setBacktestLoading(true);
    setBacktestResult(null);

    try {
      const result = await apiClient.runBacktest(strat.id, {
        days: backtestDays,
        initialCapital: backtestCapital,
        underlying: backtestUnderlying,
      });
      setBacktestResult(result);
      showFeedback(`Backtest completed for ${strat.name}: ${result.totalTrades} simulated trades.`, 'success');
    } catch (err: any) {
      showFeedback(`Backtest failed: ${err.message}`, 'error');
    } finally {
      setBacktestLoading(false);
    }
  };

  // Quick edit strategy
  const handleOpenEdit = (strat: StrategyConfig) => {
    setSelectedStrategyId(strat.id);
    setEditForm({
      name: strat.name,
      emaPeriod: strat.entry?.emaPeriod ?? 20,
      rsiPeriod: strat.entry?.rsiPeriod ?? 14,
      rsiThreshold: strat.entry?.rsiThreshold ?? 55,
      maxCapitalInr: strat.risk?.maxCapitalInr ?? 10000,
      maxAllInTradeLossInr: strat.risk?.maxAllInTradeLossInr ?? 200,
      targetNetProfitInr: strat.risk?.targetNetProfitInr ?? 300,
      maxTradesPerDay: strat.risk?.maxTradesPerDay ?? 3,
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!activeStrategy) return;
    try {
      const updated = await apiClient.updateStrategy(activeStrategy.id, {
        name: editForm.name,
        entry: {
          ...activeStrategy.entry,
          emaPeriod: Number(editForm.emaPeriod),
          rsiPeriod: Number(editForm.rsiPeriod),
          rsiThreshold: Number(editForm.rsiThreshold),
        },
        risk: {
          ...activeStrategy.risk,
          maxCapitalInr: Number(editForm.maxCapitalInr),
          maxAllInTradeLossInr: Number(editForm.maxAllInTradeLossInr),
          targetNetProfitInr: Number(editForm.targetNetProfitInr),
          maxTradesPerDay: Number(editForm.maxTradesPerDay),
        },
        maxCapitalInr: Number(editForm.maxCapitalInr),
        maxAllInTradeLossInr: Number(editForm.maxAllInTradeLossInr),
        targetNetProfitInr: Number(editForm.targetNetProfitInr),
      });

      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setIsEditModalOpen(false);
      showFeedback(`Updated strategy "${updated.name}" to Revision v${updated.version}!`, 'success');
    } catch (err: any) {
      showFeedback(`Failed to update strategy: ${err.message}`, 'error');
    }
  };

  // Create new strategy
  const handleCreateStrategy = async () => {
    if (!createForm.name.trim()) {
      showFeedback('Please provide a strategy name.', 'error');
      return;
    }

    try {
      const newStrategyPayload = {
        name: createForm.name.trim(),
        version: 1,
        status: StrategyStatus.PAPER_ACTIVE,
        tradeMode: TradeMode.PAPER,
        market: 'NSE_FO',
        underlying: createForm.underlying,
        allowedInstruments: [createForm.direction],
        timeframe: createForm.timeframe,
        session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
        entry: {
          emaPeriod: Number(createForm.emaPeriod),
          rsiPeriod: Number(createForm.rsiPeriod),
          rsiThreshold: Number(createForm.rsiThreshold),
          maxBidAskSpreadPct: 1.0,
          minVolume: 1000,
        },
        selection: {
          expiry: 'NEAREST_ELIGIBLE',
          moneyness: MoneynessType.ATM,
          minVolume: 1000,
        },
        risk: {
          maxCapitalInr: Number(createForm.maxCapitalInr),
          maxAllInTradeLossInr: Number(createForm.maxAllInTradeLossInr),
          maxAllInDailyLossInr: Number(createForm.maxAllInTradeLossInr) * 3,
          maxOpenPositions: 1,
          maxTradesPerDay: Number(createForm.maxTradesPerDay),
          targetNetProfitInr: Number(createForm.targetNetProfitInr),
          maxRoundTripCostBudgetInr: 60,
        },
        exit: {
          stopBasis: 'OPTION_PREMIUM',
          marketCutoff: '15:10',
        },
        maxCapitalInr: Number(createForm.maxCapitalInr),
        maxAllInTradeLossInr: Number(createForm.maxAllInTradeLossInr),
        maxAllInDailyLossInr: Number(createForm.maxAllInTradeLossInr) * 3,
        targetNetProfitInr: Number(createForm.targetNetProfitInr),
        maxRoundTripCostBudgetInr: 60,
        maxOpenPositions: 1,
        requiresApproval: true,
      };

      const created = await apiClient.createStrategy(newStrategyPayload);
      setStrategies((prev) => [...prev, created]);
      setSelectedStrategyId(created.id);
      setBacktestUnderlying(created.underlying as 'NIFTY' | 'BANKNIFTY');
      setIsCreateModalOpen(false);
      setCreateForm({
        name: '',
        underlying: 'NIFTY',
        direction: AllowedOptionType.LONG_CALL,
        timeframe: '5m',
        emaPeriod: 20,
        rsiPeriod: 14,
        rsiThreshold: 55,
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 200,
        targetNetProfitInr: 300,
        maxTradesPerDay: 3,
      });
      showFeedback(`Strategy "${created.name}" created successfully!`, 'success');
    } catch (err: any) {
      showFeedback(`Failed to create strategy: ${err.message}`, 'error');
    }
  };

  // View version history
  const handleOpenHistory = async (strat: StrategyConfig) => {
    setSelectedStrategyId(strat.id);
    try {
      const history = await apiClient.getStrategyVersions(strat.id);
      setHistoryList(history && history.length > 0 ? history : [strat]);
      setIsHistoryModalOpen(true);
    } catch {
      setHistoryList([strat]);
      setIsHistoryModalOpen(true);
    }
  };

  // Run live agent scan
  const handleRunAgentScan = async (strat: StrategyConfig) => {
    try {
      showFeedback(`Triggering agent scanner for ${strat.name}...`, 'info');
      const scan = await apiClient.runStrategyScan(strat.id);
      if (scan?.proposal) {
        showFeedback(`Scan generated a trade proposal for ${scan.proposal.symbol}! Check Proposals tab.`, 'success');
      } else {
        showFeedback(`Scan completed: Market checked. No setup confirmed at this minute.`, 'info');
      }
    } catch (err: any) {
      showFeedback(`Agent scan failed: ${err.message}`, 'error');
    }
  };

  return (
    <div style={{ padding: spacing.lg, maxWidth: 1280, margin: '0 auto', color: colors.textPrimary, fontFamily: typography.fontFamily.sans }}>
      
      {/* --- Top Banner / Header --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
            <span style={{ fontSize: 24 }}>⚡</span>
            <h1 style={{ fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold, margin: 0, color: colors.textPrimary }}>
              Strategy Studio & Backtesting
            </h1>
          </div>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: typography.fontSize.base }}>
            Manage simple rule-based F&O setups, run candle-by-candle historical backtests with SEBI levies, and link directly to your daily bot.
          </p>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          {dailyDraft && (
            <button
              onClick={() => router.push('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: 'rgba(6, 182, 212, 0.15)',
                border: `1px solid ${colors.cyan}`,
                color: colors.cyan,
                borderRadius: borderRadius.md,
                cursor: 'pointer',
                fontWeight: typography.fontWeight.semibold,
                fontSize: typography.fontSize.sm,
              }}
            >
              <span>←</span>
              <span>Back to Daily Bot ({dailyDraft.tradingDate})</span>
            </button>
          )}

          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `${spacing.sm}px ${spacing.md}px`,
              backgroundColor: colors.cyan,
              border: 'none',
              color: '#082F49',
              borderRadius: borderRadius.md,
              cursor: 'pointer',
              fontWeight: typography.fontWeight.bold,
              fontSize: typography.fontSize.sm,
            }}
          >
            <span>➕</span>
            <span>Create New Strategy</span>
          </button>

          <button
            onClick={loadStrategies}
            disabled={isLoading}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              backgroundColor: colors.surfaceElevated,
              border: `1px solid ${colors.border}`,
              color: colors.textPrimary,
              borderRadius: borderRadius.md,
              cursor: 'pointer',
              fontSize: typography.fontSize.sm,
            }}
          >
            {isLoading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* --- Feedback Alert Notification --- */}
      {feedback && (
        <div
          style={{
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderRadius: borderRadius.md,
            marginBottom: spacing.lg,
            backgroundColor:
              feedback.type === 'success'
                ? colors.profitMuted
                : feedback.type === 'error'
                ? colors.lossMuted
                : 'rgba(6, 182, 212, 0.15)',
            border: `1px solid ${
              feedback.type === 'success'
                ? colors.profitBorder
                : feedback.type === 'error'
                ? colors.lossBorder
                : colors.cyan
            }`,
            color:
              feedback.type === 'success'
                ? colors.profit
                : feedback.type === 'error'
                ? colors.loss
                : colors.cyan,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: typography.fontSize.sm,
          }}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* --- Section 1: Registered Strategies Cards --- */}
      <div style={{ marginBottom: spacing.xl }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
          <h2 style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, margin: 0 }}>
            Available Strategies ({strategies.length})
          </h2>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
            All strategies strictly enforce statutory SEBI limits & single-position bounds
          </span>
        </div>

        {isLoading && strategies.length === 0 ? (
          <div style={{ padding: spacing.xl, backgroundColor: colors.surface, borderRadius: borderRadius.lg, textAlign: 'center', color: colors.textSecondary }}>
            Loading strategies from API...
          </div>
        ) : strategies.length === 0 ? (
          <div style={{ padding: spacing.xl, backgroundColor: colors.surface, borderRadius: borderRadius.lg, textAlign: 'center' }}>
            <p style={{ color: colors.textSecondary, marginBottom: spacing.md }}>No strategies found.</p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.cyan,
                border: 'none',
                color: '#082F49',
                borderRadius: borderRadius.md,
                cursor: 'pointer',
                fontWeight: typography.fontWeight.bold,
              }}
            >
              ➕ Create Your First Strategy
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: spacing.md }}>
            {strategies.map((strat) => {
              const isSelected = strat.id === selectedStrategyId;
              const isCall = strat.allowedInstruments?.includes(AllowedOptionType.LONG_CALL);

              return (
                <div
                  key={strat.id}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: borderRadius.lg,
                    border: `1px solid ${isSelected ? colors.cyan : colors.border}`,
                    padding: spacing.md,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: isSelected ? '0 0 15px rgba(6, 182, 212, 0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Card Header */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: typography.fontWeight.bold, fontSize: typography.fontSize.md }}>{strat.name}</span>
                          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, backgroundColor: colors.surfaceElevated, padding: '2px 6px', borderRadius: borderRadius.sm }}>
                            v{strat.version}
                          </span>
                        </div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
                          {strat.underlying} · {strat.timeframe} Candlestick · {strat.session?.start}–{strat.session?.lastEntry} IST
                        </div>
                      </div>
                      <Badge
                        label={strat.status === StrategyStatus.PAPER_ACTIVE ? 'PAPER ACTIVE' : 'LIVE READY'}
                        variant={strat.status === StrategyStatus.PAPER_ACTIVE ? 'purple' : 'primary'}
                      />
                    </div>

                    {/* Quick Badges */}
                    <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.md }}>
                      <span style={{ fontSize: typography.fontSize.xs, padding: '3px 8px', borderRadius: borderRadius.sm, backgroundColor: isCall ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)', color: isCall ? colors.profit : colors.loss, fontWeight: typography.fontWeight.semibold }}>
                        {isCall ? '📈 Long Call (CE)' : '📉 Long Put (PE)'}
                      </span>
                      <span style={{ fontSize: typography.fontSize.xs, padding: '3px 8px', borderRadius: borderRadius.sm, backgroundColor: colors.surfaceElevated, color: colors.textSecondary }}>
                        ATM Strikes
                      </span>
                      <span style={{ fontSize: typography.fontSize.xs, padding: '3px 8px', borderRadius: borderRadius.sm, backgroundColor: colors.surfaceElevated, color: colors.textSecondary }}>
                        EMA {strat.entry?.emaPeriod ?? 20} & RSI {strat.entry?.rsiThreshold ?? 55}+
                      </span>
                    </div>

                    {/* Rule Metrics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, backgroundColor: colors.surfaceElevated, padding: spacing.sm, borderRadius: borderRadius.md, marginBottom: spacing.md }}>
                      <div>
                        <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block' }}>Max Capital</span>
                        <span style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                          ₹{strat.risk?.maxCapitalInr?.toLocaleString('en-IN') ?? '10,000'}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block' }}>Max Loss / Trade</span>
                        <span style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.loss }}>
                          ₹{strat.risk?.maxAllInTradeLossInr ?? 200}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block' }}>Target Profit</span>
                        <span style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.profit }}>
                          ₹{strat.risk?.targetNetProfitInr ?? 300}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block' }}>Daily Trades Cap</span>
                        <span style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                          {strat.risk?.maxTradesPerDay ?? 3} trades
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.sm }}>
                    <div style={{ display: 'flex', gap: spacing.xs }}>
                      <button
                        onClick={() => handleUseInDailyBot(strat)}
                        style={{
                          flex: 1,
                          padding: `${spacing.sm}px ${spacing.sm}px`,
                          backgroundColor: colors.cyan,
                          border: 'none',
                          color: '#082F49',
                          borderRadius: borderRadius.md,
                          fontWeight: typography.fontWeight.bold,
                          fontSize: typography.fontSize.xs,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <span>⚡</span>
                        <span>Use in Daily Bot</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedStrategyId(strat.id);
                          setBacktestUnderlying((strat.underlying as 'NIFTY' | 'BANKNIFTY') || 'NIFTY');
                          handleRunBacktest(strat);
                          if (backtestRef.current) {
                            backtestRef.current.scrollIntoView({ behavior: 'smooth' });
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: `${spacing.sm}px ${spacing.sm}px`,
                          backgroundColor: 'rgba(59, 130, 246, 0.15)',
                          border: `1px solid ${colors.brand}`,
                          color: colors.brand,
                          borderRadius: borderRadius.md,
                          fontWeight: typography.fontWeight.semibold,
                          fontSize: typography.fontSize.xs,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <span>🧪</span>
                        <span>Backtest</span>
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: spacing.xs }}>
                      <button
                        onClick={() => handleOpenEdit(strat)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          backgroundColor: colors.surfaceElevated,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          borderRadius: borderRadius.sm,
                          fontSize: typography.fontSize.xs,
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Edit Rules
                      </button>

                      <button
                        onClick={() => handleOpenHistory(strat)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          backgroundColor: colors.surfaceElevated,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          borderRadius: borderRadius.sm,
                          fontSize: typography.fontSize.xs,
                          cursor: 'pointer',
                        }}
                      >
                        📜 History
                      </button>

                      <button
                        onClick={() => handleRunAgentScan(strat)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          backgroundColor: colors.surfaceElevated,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          borderRadius: borderRadius.sm,
                          fontSize: typography.fontSize.xs,
                          cursor: 'pointer',
                        }}
                      >
                        🔍 Scan
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* --- Section 2: Historical Backtesting Engine --- */}
      <div
        ref={backtestRef}
        style={{
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          padding: spacing.lg,
          marginBottom: spacing.xl,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
              <span style={{ fontSize: 20 }}>🧪</span>
              <h2 style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, margin: 0 }}>
                Historical Backtesting Engine
              </h2>
            </div>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: typography.fontSize.sm, marginTop: 4 }}>
              Simulate entry on confirmed bar closes (zero look-ahead bias), dynamic delta premium tracking, and SEBI statutory levies.
            </p>
          </div>

          {activeStrategy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surfaceElevated, padding: '4px 10px', borderRadius: borderRadius.md }}>
              <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Target:</span>
              <span style={{ fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.bold, color: colors.cyan }}>
                {activeStrategy.name}
              </span>
            </div>
          )}
        </div>

        {/* Backtest Control Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing.md,
            alignItems: 'center',
            backgroundColor: colors.surfaceElevated,
            padding: spacing.md,
            borderRadius: borderRadius.md,
            marginBottom: spacing.lg,
          }}
        >
          {/* Strategy Picker */}
          <div>
            <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Strategy</label>
            <select
              value={selectedStrategyId}
              onChange={(e) => {
                setSelectedStrategyId(e.target.value);
                const found = strategies.find((s) => s.id === e.target.value);
                if (found) setBacktestUnderlying((found.underlying as 'NIFTY' | 'BANKNIFTY') || 'NIFTY');
              }}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textPrimary,
                borderRadius: borderRadius.sm,
                padding: '6px 10px',
                fontSize: typography.fontSize.sm,
              }}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.underlying})
                </option>
              ))}
            </select>
          </div>

          {/* Historical Period Pills */}
          <div>
            <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Time Window</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[7, 14, 30, 60].map((d) => (
                <button
                  key={d}
                  onClick={() => setBacktestDays(d)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: borderRadius.sm,
                    backgroundColor: backtestDays === d ? colors.cyan : colors.surface,
                    color: backtestDays === d ? '#082F49' : colors.textPrimary,
                    fontWeight: backtestDays === d ? typography.fontWeight.bold : typography.fontWeight.normal,
                    border: `1px solid ${backtestDays === d ? colors.cyan : colors.border}`,
                    cursor: 'pointer',
                    fontSize: typography.fontSize.xs,
                  }}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>

          {/* Capital Input */}
          <div>
            <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Initial Capital (₹)</label>
            <input
              type="number"
              min={1000}
              max={10000}
              value={backtestCapital}
              onChange={(e) => setBacktestCapital(Math.min(10000, Number(e.target.value)))}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textPrimary,
                borderRadius: borderRadius.sm,
                padding: '6px 10px',
                fontSize: typography.fontSize.sm,
                width: 110,
              }}
            />
          </div>

          {/* Underlying Selection */}
          <div>
            <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Underlying</label>
            <select
              value={backtestUnderlying}
              onChange={(e) => setBacktestUnderlying(e.target.value as 'NIFTY' | 'BANKNIFTY')}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textPrimary,
                borderRadius: borderRadius.sm,
                padding: '6px 10px',
                fontSize: typography.fontSize.sm,
              }}
            >
              <option value="NIFTY">NIFTY (Lot: 25)</option>
              <option value="BANKNIFTY">BANKNIFTY (Lot: 15)</option>
            </select>
          </div>

          {/* Run Button */}
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
            <button
              onClick={() => handleRunBacktest()}
              disabled={backtestLoading}
              style={{
                padding: '8px 18px',
                backgroundColor: colors.cyan,
                border: 'none',
                color: '#082F49',
                borderRadius: borderRadius.md,
                fontWeight: typography.fontWeight.bold,
                fontSize: typography.fontSize.sm,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {backtestLoading ? (
                <>
                  <span>⏳</span>
                  <span>Simulating Candles...</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>Run Historical Backtest</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Backtest Results Display */}
        {backtestResult && (
          <div>
            {/* KPI Cards Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: spacing.md, marginBottom: spacing.lg }}>
              {/* Net P&L */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.md, borderLeft: `4px solid ${backtestResult.netPnl >= 0 ? colors.profit : colors.loss}` }}>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Net P&L (After Levies)</span>
                <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: backtestResult.netPnl >= 0 ? colors.profit : colors.loss, marginTop: 4 }}>
                  {backtestResult.netPnl >= 0 ? '+' : ''}₹{backtestResult.netPnl.toLocaleString('en-IN')}
                </div>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                  Return: {((backtestResult.netPnl / backtestResult.initialCapital) * 100).toFixed(1)}%
                </span>
              </div>

              {/* Win Rate */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.md, borderLeft: `4px solid ${colors.cyan}` }}>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Win Rate</span>
                <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, marginTop: 4 }}>
                  {backtestResult.winRatePct}%
                </div>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                  {backtestResult.winningTrades} Wins / {backtestResult.losingTrades} Losses
                </span>
              </div>

              {/* Total Levies */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.md, borderLeft: `4px solid ${colors.warning}` }}>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>SEBI & Brokerage Levies</span>
                <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.warning, marginTop: 4 }}>
                  ₹{backtestResult.totalCharges.toLocaleString('en-IN')}
                </div>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                  Brokerage, STT, GST deducted
                </span>
              </div>

              {/* Max Drawdown */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.md, borderLeft: `4px solid ${colors.loss}` }}>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Max Drawdown</span>
                <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.loss, marginTop: 4 }}>
                  ₹{backtestResult.maxDrawdown.toLocaleString('en-IN')}
                </div>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                  Peak-to-trough: {backtestResult.maxDrawdownPct}%
                </span>
              </div>

              {/* Profit Factor */}
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: borderRadius.md, borderLeft: `4px solid ${colors.purple}` }}>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Profit Factor</span>
                <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, marginTop: 4 }}>
                  {backtestResult.profitFactor}x
                </div>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary }}>
                  Gross PnL: ₹{backtestResult.grossPnl.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Trade Log */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                <h3 style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold, margin: 0 }}>
                  Simulated Trade History ({backtestResult.trades.length} Trades)
                </h3>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
                  Candle timeframe: 5 minutes · Indian Market Hours (09:15-15:30 IST)
                </span>
              </div>

              {backtestResult.trades.length === 0 ? (
                <div style={{ padding: spacing.md, backgroundColor: colors.surfaceElevated, borderRadius: borderRadius.md, textAlign: 'center', color: colors.textMuted }}>
                  No setup signals triggered during the {backtestDays}-day historical window under current indicator thresholds.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: typography.fontSize.xs, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                        <th style={{ padding: '8px 10px' }}>Entry Time (IST)</th>
                        <th style={{ padding: '8px 10px' }}>Symbol</th>
                        <th style={{ padding: '8px 10px' }}>Qty</th>
                        <th style={{ padding: '8px 10px' }}>Entry ₹</th>
                        <th style={{ padding: '8px 10px' }}>Exit ₹</th>
                        <th style={{ padding: '8px 10px' }}>Gross ₹</th>
                        <th style={{ padding: '8px 10px' }}>Levies ₹</th>
                        <th style={{ padding: '8px 10px' }}>Net P&L ₹</th>
                        <th style={{ padding: '8px 10px' }}>Exit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestResult.trades.map((t, idx) => {
                        const entryDate = new Date(t.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        return (
                          <tr
                            key={t.id || idx}
                            style={{
                              borderBottom: `1px solid ${colors.border}`,
                              backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                            }}
                          >
                            <td style={{ padding: '8px 10px', color: colors.textSecondary }}>{entryDate}</td>
                            <td style={{ padding: '8px 10px', fontWeight: typography.fontWeight.semibold }}>{t.symbol}</td>
                            <td style={{ padding: '8px 10px' }}>{t.quantity}</td>
                            <td style={{ padding: '8px 10px' }}>₹{t.entryPrice.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px' }}>₹{t.exitPrice.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: t.grossPnl >= 0 ? colors.profit : colors.loss }}>
                              {t.grossPnl >= 0 ? '+' : ''}₹{t.grossPnl.toFixed(2)}
                            </td>
                            <td style={{ padding: '8px 10px', color: colors.warning }}>₹{t.charges.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: typography.fontWeight.bold, color: t.netPnl >= 0 ? colors.profit : colors.loss }}>
                              {t.netPnl >= 0 ? '+' : ''}₹{t.netPnl.toFixed(2)}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: borderRadius.sm,
                                  fontSize: 10,
                                  fontWeight: typography.fontWeight.bold,
                                  backgroundColor:
                                    t.exitReason === 'TARGET_PROFIT'
                                      ? colors.profitMuted
                                      : t.exitReason === 'STOP_LOSS'
                                      ? colors.lossMuted
                                      : 'rgba(245, 158, 11, 0.15)',
                                  color:
                                    t.exitReason === 'TARGET_PROFIT'
                                      ? colors.profit
                                      : t.exitReason === 'STOP_LOSS'
                                      ? colors.loss
                                      : colors.warning,
                                }}
                              >
                                {t.exitReason.replace(/_/g, ' ')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- Modal: Create New Strategy --- */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              width: '100%',
              maxWidth: 580,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: spacing.lg,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold }}>
                ➕ Create New Trading Strategy
              </h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 20 }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 16px 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
              Define execution rules, indicator filters, and statutory risk limits. Newly created strategies are immediately ready for backtesting and Daily Bot execution.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              {/* Strategy Name */}
              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                  Strategy Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. NIFTY Momentum Scalper"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Underlying & Direction */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Underlying Index
                  </label>
                  <select
                    value={createForm.underlying}
                    onChange={(e) => setCreateForm({ ...createForm, underlying: e.target.value as 'NIFTY' | 'BANKNIFTY' })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                    }}
                  >
                    <option value="NIFTY">NIFTY (Lot 25)</option>
                    <option value="BANKNIFTY">BANKNIFTY (Lot 15)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Option Direction
                  </label>
                  <select
                    value={createForm.direction}
                    onChange={(e) => setCreateForm({ ...createForm, direction: e.target.value as AllowedOptionType })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                    }}
                  >
                    <option value={AllowedOptionType.LONG_CALL}>Long Call (CE)</option>
                    <option value={AllowedOptionType.LONG_PUT}>Long Put (PE)</option>
                  </select>
                </div>
              </div>

              {/* Indicators */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: spacing.sm }}>
                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    EMA Period
                  </label>
                  <input
                    type="number"
                    value={createForm.emaPeriod}
                    onChange={(e) => setCreateForm({ ...createForm, emaPeriod: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    RSI Period
                  </label>
                  <input
                    type="number"
                    value={createForm.rsiPeriod}
                    onChange={(e) => setCreateForm({ ...createForm, rsiPeriod: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    RSI Trigger Level
                  </label>
                  <input
                    type="number"
                    value={createForm.rsiThreshold}
                    onChange={(e) => setCreateForm({ ...createForm, rsiThreshold: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Risk Limits */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Max Trade Capital (₹, Max 10,000)
                  </label>
                  <input
                    type="number"
                    max={10000}
                    value={createForm.maxCapitalInr}
                    onChange={(e) => setCreateForm({ ...createForm, maxCapitalInr: Math.min(10000, Number(e.target.value)) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Max Loss Per Trade (₹)
                  </label>
                  <input
                    type="number"
                    value={createForm.maxAllInTradeLossInr}
                    onChange={(e) => setCreateForm({ ...createForm, maxAllInTradeLossInr: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Target Profit (₹)
                  </label>
                  <input
                    type="number"
                    value={createForm.targetNetProfitInr}
                    onChange={(e) => setCreateForm({ ...createForm, targetNetProfitInr: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Max Trades / Day
                  </label>
                  <input
                    type="number"
                    value={createForm.maxTradesPerDay}
                    onChange={(e) => setCreateForm({ ...createForm, maxTradesPerDay: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  style={{
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.textPrimary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateStrategy}
                  style={{
                    padding: `${spacing.sm}px ${spacing.lg}px`,
                    backgroundColor: colors.cyan,
                    color: '#082F49',
                    fontWeight: typography.fontWeight.bold,
                    border: 'none',
                    borderRadius: borderRadius.md,
                    cursor: 'pointer',
                  }}
                >
                  Create Strategy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Edit Strategy --- */}
      {isEditModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              width: '100%',
              maxWidth: 540,
              padding: spacing.lg,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold }}>
                ✏️ Edit Strategy Rules (v{activeStrategy?.version})
              </h2>
              <button
                onClick={() => setIsEditModalOpen(false)}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 20 }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 16px 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
              Changing indicators or risk parameters automatically generates an immutable version revision bump with full audit tracking.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              <div>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                  Strategy Name
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: spacing.sm,
                    backgroundColor: colors.surfaceElevated,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    EMA Period
                  </label>
                  <input
                    type="number"
                    value={editForm.emaPeriod}
                    onChange={(e) => setEditForm({ ...editForm, emaPeriod: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    RSI Threshold
                  </label>
                  <input
                    type="number"
                    value={editForm.rsiThreshold}
                    onChange={(e) => setEditForm({ ...editForm, rsiThreshold: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Max Loss / Trade (₹)
                  </label>
                  <input
                    type="number"
                    value={editForm.maxAllInTradeLossInr}
                    onChange={(e) => setEditForm({ ...editForm, maxAllInTradeLossInr: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>
                    Target Profit (₹)
                  </label>
                  <input
                    type="number"
                    value={editForm.targetNetProfitInr}
                    onChange={(e) => setEditForm({ ...editForm, targetNetProfitInr: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: spacing.sm,
                      backgroundColor: colors.surfaceElevated,
                      border: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                      borderRadius: borderRadius.sm,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  style={{
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    backgroundColor: colors.surfaceElevated,
                    color: colors.textPrimary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  style={{
                    padding: `${spacing.sm}px ${spacing.lg}px`,
                    backgroundColor: colors.cyan,
                    color: '#082F49',
                    fontWeight: typography.fontWeight.bold,
                    border: 'none',
                    borderRadius: borderRadius.md,
                    cursor: 'pointer',
                  }}
                >
                  Publish New Revision
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Version Audit History --- */}
      {isHistoryModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: spacing.md,
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              width: '100%',
              maxWidth: 580,
              padding: spacing.lg,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <h2 style={{ margin: 0, fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold }}>
                📜 Immutable Revision Audit Log
              </h2>
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 20 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, maxHeight: '60vh', overflowY: 'auto' }}>
              {historyList.map((ver) => (
                <div
                  key={ver.versionHash || ver.version}
                  style={{
                    backgroundColor: colors.surfaceElevated,
                    padding: spacing.md,
                    borderRadius: borderRadius.sm,
                    border: `1px solid ${ver.version === activeStrategy?.version ? colors.cyan : colors.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                      Revision v{ver.version}.0 {ver.version === activeStrategy?.version && '(Active)'}
                    </div>
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, fontFamily: typography.fontFamily.mono, marginTop: 4 }}>
                      EMA: {ver.entry?.emaPeriod ?? 20} | RSI: {ver.entry?.rsiThreshold ?? 55} | Max Loss: ₹{ver.risk?.maxAllInTradeLossInr ?? 200}
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
