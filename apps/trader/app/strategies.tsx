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
import { PREDEFINED_STRATEGY_TEMPLATES, StrategyTemplateItem } from '@trading-bot/domain';
import { apiClient } from '../src/services/api';
import {
  loadSavedDraft,
  saveDraftToStorage,
  createDailyBotDraft,
  tradingDateInIst,
  StoredDailyBotDraft,
} from '../src/features/daily-bot/config';
import { StrategyLabTab } from '../src/features/strategy-lab/types';
import { StrategyCard } from '../src/features/strategy-lab/StrategyCard';
import { CreateChoiceModal } from '../src/features/strategy-lab/CreateChoiceModal';
import { TemplateGalleryModal } from '../src/features/strategy-lab/TemplateGalleryModal';
import { TemplateCustomizerModal } from '../src/features/strategy-lab/TemplateCustomizerModal';
import { NoCodeRuleBuilderModal } from '../src/features/strategy-lab/NoCodeRuleBuilderModal';

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

  // Strategy Lab Filters & Tabs
  const [currentTab, setCurrentTab] = useState<StrategyLabTab>('MY_STRATEGIES');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [underlyingFilter, setUnderlyingFilter] = useState<'ALL' | 'NIFTY' | 'BANKNIFTY'>('ALL');

  // Strategy Lab Modals
  const [isChoiceModalOpen, setIsChoiceModalOpen] = useState<boolean>(false);
  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState<boolean>(false);
  const [isCustomizerModalOpen, setIsCustomizerModalOpen] = useState<boolean>(false);
  const [selectedTemplate, setSelectedTemplate] = useState<StrategyTemplateItem | null>(null);
  const [isNoCodeModalOpen, setIsNoCodeModalOpen] = useState<boolean>(false);
  const [editingStrategy, setEditingStrategy] = useState<StrategyConfig | null>(null);

  // Backtest state
  const [backtestDays, setBacktestDays] = useState<number>(14);
  const [backtestCapital, setBacktestCapital] = useState<number>(10000);
  const [backtestUnderlying, setBacktestUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [backtestTimeframe, setBacktestTimeframe] = useState<'1m' | '5m' | '15m' | '30m' | '1d'>('5m');
  const [backtestFromDate, setBacktestFromDate] = useState<string>('');
  const [backtestToDate, setBacktestToDate] = useState<string>('');
  const [isCustomDateRange, setIsCustomDateRange] = useState<boolean>(false);
  const [useTrailingStop, setUseTrailingStop] = useState<boolean>(true);
  const [trailingActivationProfit, setTrailingActivationProfit] = useState<number>(150);
  const [trailingStep, setTrailingStep] = useState<number>(50);
  const [backtestMaxTradesPerDay, setBacktestMaxTradesPerDay] = useState<number>(10);
  const [backtestMaxTradeLoss, setBacktestMaxTradeLoss] = useState<number>(500);
  const [backtestMaxDailyLoss, setBacktestMaxDailyLoss] = useState<number>(500);
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);

  // Legacy Modals state
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

  // Fetch strategies from backend API with localStorage self-healing sync
  const loadStrategies = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getStrategies();
      let combined = data || [];

      // Check localStorage for custom strategies in case server was restarted
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const localStr = window.localStorage.getItem('trading_bot_custom_strategies');
          if (localStr) {
            const localList: StrategyConfig[] = JSON.parse(localStr);
            for (const localStrat of localList) {
              if (!combined.some((s) => s.id === localStrat.id)) {
                combined.push(localStrat);
                // Resync to backend so server persists it to disk
                apiClient.createStrategy(localStrat).catch(() => {});
              }
            }
          }
        } catch {
          // ignore cache parsing error
        }
      }

      if (combined && combined.length > 0) {
        setStrategies(combined);
        if (!selectedStrategyId || !combined.some((s) => s.id === selectedStrategyId)) {
          setSelectedStrategyId(combined[0]!.id);
          setBacktestUnderlying((combined[0]!.underlying as 'NIFTY' | 'BANKNIFTY') || 'NIFTY');
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

    const effectiveFrom = isCustomDateRange && (backtestFromDate || backtestToDate) ? (backtestFromDate || backtestToDate) : undefined;
    const effectiveTo = isCustomDateRange && (backtestToDate || backtestFromDate) ? (backtestToDate || backtestFromDate) : undefined;
    const [finalFrom, finalTo] = effectiveFrom && effectiveTo && effectiveFrom > effectiveTo ? [effectiveTo, effectiveFrom] : [effectiveFrom, effectiveTo];

    const backtestPayload = {
      days: backtestDays,
      initialCapital: backtestCapital,
      underlying: backtestUnderlying,
      timeframe: backtestTimeframe,
      fromDate: finalFrom,
      toDate: finalTo,
      useTrailingStop,
      trailingActivationProfitInr: trailingActivationProfit,
      trailingStepInr: trailingStep,
      maxTradesPerDay: backtestMaxTradesPerDay,
      maxTradeLossInr: backtestMaxTradeLoss,
      maxDailyLossInr: backtestMaxDailyLoss,
      strategy: strat,
    };

    try {
      const result = await apiClient.runBacktest(strat.id, backtestPayload as any);
      setBacktestResult(result);
      showFeedback(`Backtest completed for ${strat.name}: ${result.totalTrades} trades simulated on real exchange candles.`, 'success');
    } catch (err: any) {
      if ((err?.message?.includes('404') || err?.message?.includes('not found')) && strat) {
        // Self-healing: if strategy is missing from backend, automatically upload and re-run
        try {
          await apiClient.createStrategy(strat);
          const retry = await apiClient.runBacktest(strat.id, backtestPayload as any);
          setBacktestResult(retry);
          showFeedback(`Strategy resynced to server & backtest completed: ${retry.totalTrades} trades!`, 'success');
          return;
        } catch {
          // fall through
        }
      }
      showFeedback(`Backtest failed: ${err.message}`, 'error');
    } finally {
      setBacktestLoading(false);
    }
  };

  // Open editor for a strategy (No-Code if astConfig present, else legacy form)
  const handleOpenEdit = (strat: StrategyConfig) => {
    setSelectedStrategyId(strat.id);
    if (strat.astConfig) {
      setEditingStrategy(strat);
      setIsNoCodeModalOpen(true);
      return;
    }
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

  // Duplicate an existing strategy
  const handleDuplicateStrategy = async (strat: StrategyConfig) => {
    try {
      const dup = await apiClient.duplicateStrategy(strat.id);
      await loadStrategies();
      setSelectedStrategyId(dup.id);
      showFeedback(`Strategy duplicated as "${dup.name}"!`, 'success');
    } catch (err: any) {
      showFeedback(`Failed to duplicate strategy: ${err.message}`, 'error');
    }
  };

  // Toggle Archive status on a strategy
  const handleArchiveStrategy = async (strat: StrategyConfig) => {
    try {
      const updated = await apiClient.archiveStrategy(strat.id);
      await loadStrategies();
      showFeedback(
        updated.isArchived
          ? `Strategy "${updated.name}" moved to Archived.`
          : `Strategy "${updated.name}" restored to Active.`,
        'info'
      );
    } catch (err: any) {
      showFeedback(`Failed to archive strategy: ${err.message}`, 'error');
    }
  };

  // Save customized strategy from Template Customizer
  const handleSaveCustomizer = async (config: Partial<StrategyConfig>, isDraft?: boolean) => {
    try {
      const created = await apiClient.createStrategy(config as any);
      await loadStrategies();
      setSelectedStrategyId(created.id);
      setIsCustomizerModalOpen(false);
      setSelectedTemplate(null);
      showFeedback(
        `Strategy "${created.name}" created from template (${isDraft ? 'Draft' : 'Paper Active'})!`,
        'success'
      );
    } catch (err: any) {
      showFeedback(`Failed to save template strategy: ${err.message}`, 'error');
    }
  };

  // Save strategy from No-Code Rule Builder
  const handleSaveNoCode = async (config: Partial<StrategyConfig>, isDraft?: boolean) => {
    try {
      let saved: StrategyConfig;
      if (editingStrategy && editingStrategy.id) {
        saved = await apiClient.updateStrategy(editingStrategy.id, config as any);
        showFeedback(`Updated "${saved.name}" to revision v${saved.version}!`, 'success');
      } else {
        saved = await apiClient.createStrategy(config as any);
        showFeedback(
          `Created "${saved.name}" successfully (${isDraft ? 'Draft' : 'Paper Active'})!`,
          'success'
        );
      }
      await loadStrategies();
      setSelectedStrategyId(saved.id);
      setIsNoCodeModalOpen(false);
      setEditingStrategy(null);
    } catch (err: any) {
      showFeedback(`Failed to save strategy: ${err.message}`, 'error');
    }
  };

  // Quick clone template without customization
  const handleQuickCloneTemplate = async (template: StrategyTemplateItem) => {
    try {
      const created = await apiClient.createStrategyFromTemplate(template.id);
      await loadStrategies();
      setSelectedStrategyId(created.id);
      showFeedback(`Template "${template.name}" cloned into My Strategies!`, 'success');
      setCurrentTab('MY_STRATEGIES');
    } catch (err: any) {
      showFeedback(`Failed to clone template: ${err.message}`, 'error');
    }
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

      setStrategies((prev) => {
        const next = prev.map((s) => (s.id === updated.id ? updated : s));
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem('trading_bot_custom_strategies', JSON.stringify(next));
          } catch {}
        }
        return next;
      });
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
      setStrategies((prev) => {
        const next = [...prev, created];
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem('trading_bot_custom_strategies', JSON.stringify(next));
          } catch {}
        }
        return next;
      });
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
            onClick={() => setIsChoiceModalOpen(true)}
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
            <span>Create Strategy</span>
          </button>

          <button
            onClick={() => setIsGalleryModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `${spacing.sm}px ${spacing.md}px`,
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: `1px solid ${colors.brand}`,
              color: colors.brand,
              borderRadius: borderRadius.md,
              cursor: 'pointer',
              fontWeight: typography.fontWeight.semibold,
              fontSize: typography.fontSize.sm,
            }}
          >
            <span>📑</span>
            <span>Templates Gallery</span>
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

      {/* --- Section 1: Strategy Lab Tabs & Cards --- */}
      <div style={{ marginBottom: spacing.xl }}>
        {/* Lab Header & Subtitle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          <div>
            <h2 style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, margin: 0, color: colors.textPrimary }}>
              Strategy Lab
            </h2>
            <p style={{ margin: 0, fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
              Build and manage quantitative F&O systems via predefined templates or no-code visual rule blocks.
            </p>
          </div>
        </div>

        {/* Category Tabs */}
        <div
          style={{
            display: 'flex',
            gap: spacing.xs,
            overflowX: 'auto',
            paddingBottom: spacing.sm,
            borderBottom: `1px solid ${colors.border}`,
            marginBottom: spacing.md,
          }}
        >
          {[
            { id: 'MY_STRATEGIES' as StrategyLabTab, label: 'My Strategies', icon: '🌟', count: strategies.filter((s) => !s.isArchived && s.status !== StrategyStatus.ARCHIVED).length },
            { id: 'TEMPLATES' as StrategyLabTab, label: 'Predefined Templates', icon: '📑', count: PREDEFINED_STRATEGY_TEMPLATES.length },
            { id: 'DRAFTS' as StrategyLabTab, label: 'Draft Strategies', icon: '📝', count: strategies.filter((s) => !s.isArchived && s.status === StrategyStatus.DRAFT).length },
            { id: 'BACKTESTED' as StrategyLabTab, label: 'Backtested', icon: '🧪', count: strategies.filter((s) => !s.isArchived && s.status === StrategyStatus.BACKTESTED).length },
            { id: 'PAPER' as StrategyLabTab, label: 'Paper-Tested', icon: '📄', count: strategies.filter((s) => !s.isArchived && s.status === StrategyStatus.PAPER_ACTIVE).length },
            { id: 'LIVE_ELIGIBLE' as StrategyLabTab, label: 'Live-Eligible', icon: '🛡️', count: strategies.filter((s) => !s.isArchived && (s.status === StrategyStatus.APPROVAL_READY || s.status === StrategyStatus.AUTO_ELIGIBLE)).length },
            { id: 'ARCHIVED' as StrategyLabTab, label: 'Archived', icon: '🗄️', count: strategies.filter((s) => s.isArchived || s.status === StrategyStatus.ARCHIVED).length },
          ].map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: borderRadius.md,
                  backgroundColor: isActive ? 'rgba(6, 182, 212, 0.15)' : colors.surface,
                  border: `1px solid ${isActive ? colors.cyan : colors.border}`,
                  color: isActive ? colors.cyan : colors.textSecondary,
                  fontWeight: isActive ? typography.fontWeight.bold : typography.fontWeight.normal,
                  fontSize: typography.fontSize.xs,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  style={{
                    backgroundColor: isActive ? colors.cyan : colors.surfaceElevated,
                    color: isActive ? '#082F49' : colors.textMuted,
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontWeight: typography.fontWeight.bold,
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Underlying Filter Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: spacing.sm,
            marginBottom: spacing.md,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 260 }}>
            <input
              type="text"
              placeholder={currentTab === 'TEMPLATES' ? 'Search templates...' : 'Search strategies by name, description, indicator...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                maxWidth: 400,
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textPrimary,
                borderRadius: borderRadius.md,
                padding: '6px 12px',
                fontSize: typography.fontSize.xs,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 12 }}
              >
                ✕ Clear
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Underlying:</span>
            {(['ALL', 'NIFTY', 'BANKNIFTY'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnderlyingFilter(u)}
                style={{
                  padding: '4px 8px',
                  borderRadius: borderRadius.sm,
                  backgroundColor: underlyingFilter === u ? colors.cyan : colors.surfaceElevated,
                  color: underlyingFilter === u ? '#082F49' : colors.textSecondary,
                  border: `1px solid ${underlyingFilter === u ? colors.cyan : colors.border}`,
                  fontSize: 11,
                  fontWeight: underlyingFilter === u ? typography.fontWeight.bold : typography.fontWeight.normal,
                  cursor: 'pointer',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* TAB CONTENT: PREDEFINED TEMPLATES */}
        {currentTab === 'TEMPLATES' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: spacing.md }}>
            {PREDEFINED_STRATEGY_TEMPLATES.filter((tpl) => {
              if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                if (!tpl.name.toLowerCase().includes(q) && !tpl.description.toLowerCase().includes(q)) return false;
              }
              if (underlyingFilter !== 'ALL' && tpl.recommendedUnderlying !== underlyingFilter) return false;
              return true;
            }).map((tpl) => {
              const indicators = tpl.astConfig.indicators?.map((i) => `${i.type}${i.period ? ` (${i.period})` : ''}`) || [];
              return (
                <div
                  key={tpl.id}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: borderRadius.lg,
                    border: `1px solid ${colors.border}`,
                    padding: spacing.md,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <span style={{ fontWeight: typography.fontWeight.bold, fontSize: typography.fontSize.md, color: colors.textPrimary }}>
                        {tpl.name}
                      </span>
                      <Badge label={tpl.category} variant="primary" />
                    </div>
                    <p style={{ margin: 0, color: colors.textSecondary, fontSize: typography.fontSize.xs, lineHeight: 1.4 }}>
                      {tpl.description}
                    </p>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: spacing.sm }}>
                      <Badge label={tpl.recommendedUnderlying} variant="neutral" />
                      <Badge label={`${tpl.recommendedTimeframe} Candles`} variant="neutral" />
                      {indicators.map((ind, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: borderRadius.sm,
                            backgroundColor: colors.surfaceElevated,
                            color: colors.textMuted,
                            fontWeight: typography.fontWeight.semibold,
                          }}
                        >
                          {ind}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: spacing.xs, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.sm, marginTop: spacing.xs }}>
                    <button
                      onClick={() => {
                        setSelectedTemplate(tpl);
                        setIsCustomizerModalOpen(true);
                      }}
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
                      <span>Customize</span>
                    </button>

                    <button
                      onClick={() => handleQuickCloneTemplate(tpl)}
                      style={{
                        flex: 1,
                        padding: `${spacing.sm}px ${spacing.sm}px`,
                        backgroundColor: colors.surfaceElevated,
                        border: `1px solid ${colors.border}`,
                        color: colors.textPrimary,
                        borderRadius: borderRadius.md,
                        fontSize: typography.fontSize.xs,
                        fontWeight: typography.fontWeight.semibold,
                        cursor: 'pointer',
                      }}
                    >
                      📋 Quick Clone
                    </button>

                    <button
                      onClick={() => {
                        const tplConfig: StrategyConfig = {
                          ...(tpl.defaultConfig as any),
                          id: tpl.id,
                          name: tpl.name,
                          underlying: tpl.recommendedUnderlying,
                          timeframe: tpl.recommendedTimeframe,
                          astConfig: tpl.astConfig,
                        };
                        setSelectedStrategyId(tpl.id);
                        setBacktestUnderlying(tpl.recommendedUnderlying);
                        handleRunBacktest(tplConfig);
                        if (backtestRef.current) {
                          backtestRef.current.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      style={{
                        padding: `${spacing.sm}px 10px`,
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        border: `1px solid ${colors.brand}`,
                        color: colors.brand,
                        borderRadius: borderRadius.md,
                        fontSize: typography.fontSize.xs,
                        fontWeight: typography.fontWeight.semibold,
                        cursor: 'pointer',
                      }}
                    >
                      🧪 Test
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB CONTENT: STRATEGY CARDS */}
        {currentTab !== 'TEMPLATES' && (
          <>
            {isLoading && strategies.length === 0 ? (
              <div style={{ padding: spacing.xl, backgroundColor: colors.surface, borderRadius: borderRadius.lg, textAlign: 'center', color: colors.textSecondary }}>
                Loading strategies from API...
              </div>
            ) : (() => {
              const filteredList = strategies.filter((s) => {
                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase();
                  const matchesName = s.name.toLowerCase().includes(q);
                  const matchesDesc = s.description?.toLowerCase().includes(q);
                  const matchesUnderlying = s.underlying.toLowerCase().includes(q);
                  if (!matchesName && !matchesDesc && !matchesUnderlying) return false;
                }

                if (underlyingFilter !== 'ALL' && s.underlying !== underlyingFilter) {
                  return false;
                }

                const isArch = s.isArchived === true || s.status === StrategyStatus.ARCHIVED;
                if (currentTab === 'ARCHIVED') return isArch;
                if (isArch) return false;

                switch (currentTab) {
                  case 'MY_STRATEGIES':
                    return true;
                  case 'DRAFTS':
                    return s.status === StrategyStatus.DRAFT;
                  case 'BACKTESTED':
                    return s.status === StrategyStatus.BACKTESTED;
                  case 'PAPER':
                    return s.status === StrategyStatus.PAPER_ACTIVE;
                  case 'LIVE_ELIGIBLE':
                    return s.status === StrategyStatus.APPROVAL_READY || s.status === StrategyStatus.AUTO_ELIGIBLE;
                  default:
                    return true;
                }
              });

              if (filteredList.length === 0) {
                return (
                  <div style={{ padding: spacing.xl, backgroundColor: colors.surface, borderRadius: borderRadius.lg, textAlign: 'center' }}>
                    <p style={{ color: colors.textSecondary, marginBottom: spacing.md }}>
                      No strategies found in this category.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: spacing.sm }}>
                      <button
                        onClick={() => setIsChoiceModalOpen(true)}
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
                        ➕ Create Strategy
                      </button>
                      <button
                        onClick={() => setCurrentTab('TEMPLATES')}
                        style={{
                          padding: `${spacing.sm}px ${spacing.md}px`,
                          backgroundColor: colors.surfaceElevated,
                          border: `1px solid ${colors.border}`,
                          color: colors.textPrimary,
                          borderRadius: borderRadius.md,
                          cursor: 'pointer',
                        }}
                      >
                        📑 Browse Predefined Templates
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: spacing.md }}>
                  {filteredList.map((strat) => (
                    <StrategyCard
                      key={strat.id}
                      strategy={strat}
                      isSelected={strat.id === selectedStrategyId}
                      onSelect={() => {
                        setSelectedStrategyId(strat.id);
                        setBacktestUnderlying((strat.underlying as any) || 'NIFTY');
                      }}
                      onEdit={() => handleOpenEdit(strat)}
                      onDuplicate={() => handleDuplicateStrategy(strat)}
                      onTest={() => {
                        setSelectedStrategyId(strat.id);
                        setBacktestUnderlying((strat.underlying as any) || 'NIFTY');
                        handleRunBacktest(strat);
                        if (backtestRef.current) {
                          backtestRef.current.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      onArchive={() => handleArchiveStrategy(strat)}
                      onUseInDailyBot={() => handleUseInDailyBot(strat)}
                      onHistory={() => handleOpenHistory(strat)}
                      onScan={() => handleRunAgentScan(strat)}
                    />
                  ))}
                </div>
              );
            })()}
          </>
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
            flexDirection: 'column',
            gap: spacing.md,
            backgroundColor: colors.surfaceElevated,
            padding: spacing.md,
            borderRadius: borderRadius.md,
            marginBottom: spacing.lg,
          }}
        >
          {/* Row 1: Strategy, Underlying, Timeframe & Initial Capital */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
            {/* Strategy Picker */}
            <div style={{ minWidth: 200, flex: '1 1 200px' }}>
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
                  width: '100%',
                }}
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.underlying})
                  </option>
                ))}
              </select>
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

            {/* Timeframe Selector */}
            <div>
              <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Candle Timeframe</label>
              <select
                value={backtestTimeframe}
                onChange={(e) => setBacktestTimeframe(e.target.value as any)}
                style={{
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  color: colors.textPrimary,
                  borderRadius: borderRadius.sm,
                  padding: '6px 10px',
                  fontSize: typography.fontSize.sm,
                }}
              >
                <option value="1m">1m (Intraday Scalp)</option>
                <option value="5m">5m (Recommended)</option>
                <option value="15m">15m (Trend Swing)</option>
                <option value="30m">30m (Positional)</option>
                <option value="1d">1d (Daily EOD)</option>
              </select>
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
          </div>

          {/* Row 2: Date Range Selection & Trailing Stop Loss */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center', paddingTop: spacing.xs, borderTop: `1px solid ${colors.border}` }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Date Range</label>
                <button
                  onClick={() => {
                    const nextVal = !isCustomDateRange;
                    setIsCustomDateRange(nextVal);
                    if (nextVal && !backtestFromDate) {
                      const today = new Date().toISOString().slice(0, 10);
                      setBacktestFromDate(today);
                      setBacktestToDate(today);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: colors.cyan,
                    fontSize: 11,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {isCustomDateRange ? '⚡ Switch to Quick Days' : '📅 Custom Date Range'}
                </button>
              </div>

              {!isCustomDateRange ? (
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
              ) : (
                <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>From:</span>
                    <input
                      type="date"
                      value={backtestFromDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBacktestFromDate(val);
                        if (!backtestToDate || backtestToDate < val) {
                          setBacktestToDate(val);
                        }
                      }}
                      style={{
                        backgroundColor: colors.surface,
                        border: `1px solid ${colors.border}`,
                        color: colors.textPrimary,
                        borderRadius: borderRadius.sm,
                        padding: '4px 8px',
                        fontSize: typography.fontSize.xs,
                      }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>To:</span>
                    <input
                      type="date"
                      value={backtestToDate}
                      onChange={(e) => setBacktestToDate(e.target.value)}
                      style={{
                        backgroundColor: colors.surface,
                        border: `1px solid ${colors.border}`,
                        color: colors.textPrimary,
                        borderRadius: borderRadius.sm,
                        padding: '4px 8px',
                        fontSize: typography.fontSize.xs,
                      }}
                    />
                  </div>
                  {backtestFromDate && backtestToDate !== backtestFromDate && (
                    <button
                      type="button"
                      onClick={() => setBacktestToDate(backtestFromDate)}
                      style={{
                        backgroundColor: 'transparent',
                        border: `1px dashed ${colors.border}`,
                        borderRadius: borderRadius.sm,
                        color: colors.cyan,
                        fontSize: 10,
                        padding: '3px 6px',
                        cursor: 'pointer',
                      }}
                      title="Set To date equal to From date for single-day intraday backtesting"
                    >
                      Single Day
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Risk Rules: Max Trades/Day & Loss Invariants */}
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
              <div title="Max trades per day (trading halts early if single trade loss hits max or cumulative loss hits daily limit)">
                <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>Trades/Day:</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={backtestMaxTradesPerDay}
                  onChange={(e) => setBacktestMaxTradesPerDay(Number(e.target.value))}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    padding: '4px 6px',
                    fontSize: typography.fontSize.xs,
                    width: 50,
                  }}
                />
              </div>
              <div title="If a single trade loses this amount, trading halts for the rest of the day">
                <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>Trade Max Loss ₹:</span>
                <input
                  type="number"
                  min={100}
                  step={50}
                  value={backtestMaxTradeLoss}
                  onChange={(e) => setBacktestMaxTradeLoss(Number(e.target.value))}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    padding: '4px 6px',
                    fontSize: typography.fontSize.xs,
                    width: 65,
                  }}
                />
              </div>
              <div title="If cumulative daily loss reaches this amount, trading halts for the rest of the day">
                <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>Daily Loss Limit ₹:</span>
                <input
                  type="number"
                  min={100}
                  step={50}
                  value={backtestMaxDailyLoss}
                  onChange={(e) => setBacktestMaxDailyLoss(Number(e.target.value))}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    borderRadius: borderRadius.sm,
                    padding: '4px 6px',
                    fontSize: typography.fontSize.xs,
                    width: 65,
                  }}
                />
              </div>
            </div>

            {/* Trailing Stop Loss Toggle & Inputs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: typography.fontSize.xs, color: colors.textPrimary }}>
                <input
                  type="checkbox"
                  checked={useTrailingStop}
                  onChange={(e) => setUseTrailingStop(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontWeight: typography.fontWeight.semibold }}>📈 Trailing SL</span>
              </label>

              {useTrailingStop && (
                <div style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
                  <div title="Profit required before stop loss starts trailing">
                    <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>Activate ₹:</span>
                    <input
                      type="number"
                      min={50}
                      step={50}
                      value={trailingActivationProfit}
                      onChange={(e) => setTrailingActivationProfit(Number(e.target.value))}
                      style={{
                        backgroundColor: colors.surface,
                        border: `1px solid ${colors.border}`,
                        color: colors.textPrimary,
                        borderRadius: borderRadius.sm,
                        padding: '4px 6px',
                        fontSize: typography.fontSize.xs,
                        width: 65,
                      }}
                    />
                  </div>
                  <div title="Step to trail stop loss upward as profit advances">
                    <span style={{ fontSize: 10, color: colors.textMuted, marginRight: 4 }}>Step ₹:</span>
                    <input
                      type="number"
                      min={10}
                      step={10}
                      value={trailingStep}
                      onChange={(e) => setTrailingStep(Number(e.target.value))}
                      style={{
                        backgroundColor: colors.surface,
                        border: `1px solid ${colors.border}`,
                        color: colors.textPrimary,
                        borderRadius: borderRadius.sm,
                        padding: '4px 6px',
                        fontSize: typography.fontSize.xs,
                        width: 55,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Run Button */}
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
                    <span>Simulating Real Data...</span>
                  </>
                ) : (
                  <>
                    <span>▶</span>
                    <span>Run Backtest (Real Data)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Backtest Results Display */}
        {backtestResult && (
          <div>
            {/* Capital / Validation Error Banner */}
            {backtestResult.error && (
              <div style={{
                margin: `${spacing.md} 0`,
                padding: spacing.md,
                borderRadius: borderRadius.md,
                background: 'rgba(255,59,48,0.12)',
                border: `1.5px solid ${colors.loss}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: spacing.sm,
              }}>
                <span style={{ fontSize: 22 }}>⛔</span>
                <div>
                  <div style={{ fontWeight: typography.fontWeight.bold, color: colors.loss, marginBottom: 4 }}>
                    Backtest Aborted
                  </div>
                  <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
                    {backtestResult.error}
                  </div>
                </div>
              </div>
            )}
            {/* Only render the full results panel when there is no error */}
            {!backtestResult.error && (
              <>
            {/* Real Market Data Badge & Meta Header */}
            <div
              style={{

                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: borderRadius.md,
                padding: `${spacing.sm}px ${spacing.md}px`,
                marginBottom: spacing.md,
                flexWrap: 'wrap',
                gap: spacing.xs,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                <Badge
                  label={backtestResult.dataSource === 'REAL_NSE_EXCHANGE_FEED' ? '🟢 100% Real Exchange Feed (NSE India)' : '🟢 Real Market Candles'}
                  variant="success"
                  size="sm"
                />
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textPrimary, fontWeight: typography.fontWeight.semibold }}>
                  {backtestResult.strategyName} (v{backtestResult.version})
                </span>
              </div>
              <div style={{ display: 'flex', gap: spacing.sm, fontSize: typography.fontSize.xs, color: colors.textSecondary, flexWrap: 'wrap' }}>
                {(() => {
                  const fromFormatted = backtestResult.fromDate ? new Date(backtestResult.fromDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit', year: 'numeric' }) : '—';
                  const toFormatted = backtestResult.toDate ? new Date(backtestResult.toDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit', year: 'numeric' }) : '—';
                  const isSingleDay = fromFormatted === toFormatted && fromFormatted !== '—';
                  return isSingleDay ? (
                    <span>Date: <strong style={{ color: colors.textPrimary }}>{fromFormatted} (Intraday)</strong></span>
                  ) : (
                    <>
                      <span>From: <strong style={{ color: colors.textPrimary }}>{fromFormatted}</strong></span>
                      <span>To: <strong style={{ color: colors.textPrimary }}>{toFormatted}</strong></span>
                    </>
                  );
                })()}
                <span>Timeframe: <strong style={{ color: colors.cyan }}>{backtestResult.timeframe || backtestTimeframe}</strong></span>
                {useTrailingStop && (
                  <span style={{ color: colors.purple, fontWeight: typography.fontWeight.semibold }}>
                    ✨ Trailing SL Active (Act: ₹{trailingActivationProfit}, Step: ₹{trailingStep})
                  </span>
                )}
              </div>
            </div>

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, flexWrap: 'wrap', gap: spacing.xs }}>
                <h3 style={{ fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold, margin: 0 }}>
                  Simulated Trade History ({backtestResult.trades.length} Trades)
                </h3>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
                  Candle timeframe: {backtestResult.timeframe || backtestTimeframe} · Indian Market Hours (09:15-15:30 IST)
                </span>
              </div>

              {backtestResult.trades.length === 0 ? (
                <div style={{ padding: spacing.md, backgroundColor: colors.surfaceElevated, borderRadius: borderRadius.md, textAlign: 'center', color: colors.textMuted }}>
                  No setup signals triggered during the {isCustomDateRange ? 'selected date window' : `${backtestDays}-day window`} under current indicator thresholds.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: typography.fontSize.xs, textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                        <th style={{ padding: '8px 10px' }}>Entry Time (IST, Sec)</th>
                        <th style={{ padding: '8px 10px' }}>Exit Time (IST, Sec)</th>
                        <th style={{ padding: '8px 10px' }}>Duration</th>
                        <th style={{ padding: '8px 10px' }}>Symbol</th>
                        <th style={{ padding: '8px 10px' }}>Qty</th>
                        <th style={{ padding: '8px 10px' }}>Entry ₹</th>
                        <th style={{ padding: '8px 10px' }}>Initial SL ₹</th>
                        <th style={{ padding: '8px 10px' }}>Exit ₹</th>
                        <th style={{ padding: '8px 10px' }}>Gross ₹</th>
                        <th style={{ padding: '8px 10px' }}>Levies ₹</th>
                        <th style={{ padding: '8px 10px' }}>Net P&L ₹</th>
                        <th style={{ padding: '8px 10px' }}>Exit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestResult.trades.map((t, idx) => {
                        const entryDate = new Date(t.entryTime).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });
                        const exitDate = t.exitTime
                          ? new Date(t.exitTime).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              month: 'short',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : '—';
                        const durationStr = t.durationMinutes ? `${t.durationMinutes}m` : '—';
                        return (
                          <tr
                            key={t.id || idx}
                            style={{
                              borderBottom: `1px solid ${colors.border}`,
                              backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                            }}
                          >
                            <td style={{ padding: '8px 10px', color: colors.textSecondary, fontFamily: 'monospace' }}>{entryDate}</td>
                            <td style={{ padding: '8px 10px', color: colors.textSecondary, fontFamily: 'monospace' }}>{exitDate}</td>
                            <td style={{ padding: '8px 10px', color: colors.cyan, fontWeight: typography.fontWeight.semibold }}>{durationStr}</td>
                            <td style={{ padding: '8px 10px', fontWeight: typography.fontWeight.semibold }}>{t.symbol}</td>
                            <td style={{ padding: '8px 10px' }}>{t.quantity}</td>
                            <td style={{ padding: '8px 10px' }}>₹{t.entryPrice.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: colors.loss }}>
                              {t.initialStopPrice ? `₹${t.initialStopPrice.toFixed(2)}` : '—'}
                            </td>
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
                                    t.exitReason === 'TRAILING_STOP_LOSS'
                                      ? 'rgba(168, 85, 247, 0.15)'
                                      : t.exitReason === 'TARGET_PROFIT'
                                      ? colors.profitMuted
                                      : t.exitReason === 'STOP_LOSS'
                                      ? colors.lossMuted
                                      : t.exitReason === 'DATASET_END'
                                      ? 'rgba(99, 102, 241, 0.15)'
                                      : 'rgba(245, 158, 11, 0.15)',
                                  color:
                                    t.exitReason === 'TRAILING_STOP_LOSS'
                                      ? colors.purple
                                      : t.exitReason === 'TARGET_PROFIT'
                                      ? colors.profit
                                      : t.exitReason === 'STOP_LOSS'
                                      ? colors.loss
                                      : t.exitReason === 'DATASET_END'
                                      ? '#818cf8'
                                      : colors.warning,
                                }}
                              >
                                {t.exitReason === 'TRAILING_STOP_LOSS'
                                  ? '✨ TRAILING SL'
                                  : t.exitReason === 'TARGET_PROFIT'
                                  ? '🎯 TARGET'
                                  : t.exitReason === 'DATASET_END'
                                  ? '📊 DATA END'
                                  : t.exitReason.replace(/_/g, ' ')}
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
            {/* end !backtestResult.error */}
            </>
            )}
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

      {/* --- Strategy Lab Modal: Creation Choice (Template vs Scratch) --- */}
      <CreateChoiceModal
        isOpen={isChoiceModalOpen}
        onClose={() => setIsChoiceModalOpen(false)}
        onSelectTemplate={() => {
          setIsChoiceModalOpen(false);
          setIsGalleryModalOpen(true);
        }}
        onSelectNoCode={() => {
          setIsChoiceModalOpen(false);
          setEditingStrategy(null);
          setIsNoCodeModalOpen(true);
        }}
      />

      {/* --- Strategy Lab Modal: Template Gallery --- */}
      <TemplateGalleryModal
        isOpen={isGalleryModalOpen}
        onClose={() => setIsGalleryModalOpen(false)}
        onSelectCustomize={(tpl: StrategyTemplateItem) => {
          setIsGalleryModalOpen(false);
          setSelectedTemplate(tpl);
          setIsCustomizerModalOpen(true);
        }}
        onQuickClone={handleQuickCloneTemplate}
      />

      {/* --- Strategy Lab Modal: Template Customizer --- */}
      <TemplateCustomizerModal
        isOpen={isCustomizerModalOpen}
        template={selectedTemplate}
        onClose={() => {
          setIsCustomizerModalOpen(false);
          setSelectedTemplate(null);
        }}
        onSave={handleSaveCustomizer}
        onBacktest={(cfg) => {
          setIsCustomizerModalOpen(false);
          handleRunBacktest(cfg as any);
          if (backtestRef.current) {
            backtestRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }}
      />

      {/* --- Strategy Lab Modal: Visual No-Code Rule Builder --- */}
      <NoCodeRuleBuilderModal
        isOpen={isNoCodeModalOpen}
        initialStrategy={editingStrategy}
        onClose={() => {
          setIsNoCodeModalOpen(false);
          setEditingStrategy(null);
        }}
        onSave={handleSaveNoCode}
        onBacktest={(cfg) => {
          setIsNoCodeModalOpen(false);
          handleRunBacktest(cfg as any);
          if (backtestRef.current) {
            backtestRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }}
      />

    </div>
  );
}
