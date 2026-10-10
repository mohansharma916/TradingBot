import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Switch } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import {
  AllowedOptionType,
  ComparisonOperator,
  ConditionRule,
  ExpirySelection,
  IndicatorType,
  LogicalOperator,
  RuleGroup,
  StrategyAstConfig,
  StrategyConfig,
  StrategyIndicatorConfig,
  StrategyStatus,
  StrikeSelection,
  TradeDirection,
  TradeMode,
  TrailingProfitMode,
} from '@trading-bot/contracts';

interface NoCodeRuleBuilderModalProps {
  isOpen: boolean;
  initialStrategy?: StrategyConfig | null;
  onClose: () => void;
  onSave: (config: Partial<StrategyConfig>, isDraft?: boolean) => Promise<void>;
  onBacktest: (config: Partial<StrategyConfig>) => void;
}

export function NoCodeRuleBuilderModal({
  isOpen,
  initialStrategy,
  onClose,
  onSave,
  onBacktest,
}: NoCodeRuleBuilderModalProps) {
  if (!isOpen) return null;

  // Active builder tab for clean organization
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'INDICATORS' | 'ENTRY_RULES' | 'EXITS' | 'CONTRACTS' | 'PREVIEW'>('DETAILS');

  // Section 1: Basic details
  const [name, setName] = useState(initialStrategy?.name || 'My Custom Visual Strategy');
  const [description, setDescription] = useState(initialStrategy?.description || '');
  const [category, setCategory] = useState(initialStrategy?.category || 'MOMENTUM');
  const [underlying, setUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>((initialStrategy?.underlying as any) || 'NIFTY');
  const [direction, setDirection] = useState<TradeDirection>(initialStrategy?.astConfig?.direction || TradeDirection.BOTH);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m'>(initialStrategy?.timeframe as any || '5m');
  const [sessionStart, setSessionStart] = useState(initialStrategy?.session?.start || '09:25');
  const [sessionLastEntry, setSessionLastEntry] = useState(initialStrategy?.session?.lastEntry || '14:45');
  const [marketCutoff, setMarketCutoff] = useState(initialStrategy?.exit?.marketCutoff || '15:10');

  // Section 2: Indicator Library
  const [indicators, setIndicators] = useState<StrategyIndicatorConfig[]>(
    initialStrategy?.astConfig?.indicators || [
      { id: 'ema_fast', type: IndicatorType.EMA, period: 20, source: 'close' },
      { id: 'ema_slow', type: IndicatorType.EMA, period: 50, source: 'close' },
      { id: 'rsi_14', type: IndicatorType.RSI, period: 14, source: 'close' },
    ]
  );

  // Section 3 & 4 & 5: Entry Rules (Bullish & Bearish groups)
  const [bullishEntry, setBullishEntry] = useState<RuleGroup>(
    initialStrategy?.astConfig?.bullishEntry || {
      id: 'group_bullish_root',
      operator: LogicalOperator.AND,
      enabled: true,
      description: 'Bullish Entry Conditions',
      conditions: [
        {
          id: 'cond_bull_1',
          left: { type: 'INDICATOR', indicatorId: 'ema_fast', offset: 0 },
          comparison: ComparisonOperator.GT,
          right: { type: 'INDICATOR', indicatorId: 'ema_slow', offset: 0 },
          enabled: true,
          description: 'EMA Fast > EMA Slow',
        },
        {
          id: 'cond_bull_2',
          left: { type: 'INDICATOR', indicatorId: 'rsi_14', offset: 0 },
          comparison: ComparisonOperator.GT,
          right: { type: 'NUMBER', value: 55 },
          enabled: true,
          description: 'RSI > 55',
        },
      ],
    }
  );

  const [bearishEntry, setBearishEntry] = useState<RuleGroup>(
    initialStrategy?.astConfig?.bearishEntry || {
      id: 'group_bearish_root',
      operator: LogicalOperator.AND,
      enabled: true,
      description: 'Bearish Entry Conditions',
      conditions: [
        {
          id: 'cond_bear_1',
          left: { type: 'INDICATOR', indicatorId: 'ema_fast', offset: 0 },
          comparison: ComparisonOperator.LT,
          right: { type: 'INDICATOR', indicatorId: 'ema_slow', offset: 0 },
          enabled: true,
          description: 'EMA Fast < EMA Slow',
        },
        {
          id: 'cond_bear_2',
          left: { type: 'INDICATOR', indicatorId: 'rsi_14', offset: 0 },
          comparison: ComparisonOperator.LT,
          right: { type: 'NUMBER', value: 45 },
          enabled: true,
          description: 'RSI < 45',
        },
      ],
    }
  );

  // Section 6: F&O Contract Selection
  const [instrumentType, setInstrumentType] = useState<'OPTIONS' | 'FUTURES'>('OPTIONS');
  const [strikeSelection, setStrikeSelection] = useState<StrikeSelection>(StrikeSelection.ATM);
  const [expiry, setExpiry] = useState<ExpirySelection>(ExpirySelection.NEAREST_ELIGIBLE);
  const [minPremium, setMinPremium] = useState('25');
  const [maxPremium, setMaxPremium] = useState('400');
  const [maxBidAskSpreadPct, setMaxBidAskSpreadPct] = useState('1.5');

  // Section 7: Exit Rules
  const [stopLossPoints, setStopLossPoints] = useState(
    String(initialStrategy?.exit?.stopLossPoints ?? initialStrategy?.astConfig?.exitRules?.stopLossValue ?? 8)
  );
  const [targetProfitPoints, setTargetProfitPoints] = useState(
    String(initialStrategy?.exit?.targetPoints ?? initialStrategy?.astConfig?.exitRules?.targetProfitValue ?? 16)
  );
  const [exitOnOppositeSignal, setExitOnOppositeSignal] = useState(
    initialStrategy?.astConfig?.exitRules?.exitOnOppositeSignal ?? true
  );

  // Section 8: Trailing Profit Rules
  const [useTrailing, setUseTrailing] = useState(
    initialStrategy?.astConfig?.trailingProfit?.enabled ?? true
  );
  const [trailingMode, setTrailingMode] = useState<TrailingProfitMode>(
    initialStrategy?.astConfig?.trailingProfit?.mode ?? TrailingProfitMode.FIXED_STEP
  );
  const [trailingActivationProfit, setTrailingActivationProfit] = useState(
    String(initialStrategy?.astConfig?.trailingProfit?.activationProfitInr ?? 150)
  );
  const [trailingStep, setTrailingStep] = useState(
    String(initialStrategy?.astConfig?.trailingProfit?.adjustmentStepInr ?? 50)
  );

  // Risk limits
  const [maxCapitalInr, setMaxCapitalInr] = useState(
    String(initialStrategy?.risk?.maxCapitalInr ?? 10000)
  );
  const [maxAllInTradeLossInr, setMaxAllInTradeLossInr] = useState(
    String(initialStrategy?.risk?.maxAllInTradeLossInr ?? 200)
  );
  const [targetNetProfitInr, setTargetNetProfitInr] = useState(
    String(initialStrategy?.risk?.targetNetProfitInr ?? 300)
  );
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(
    String(initialStrategy?.risk?.maxTradesPerDay ?? 3)
  );

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // Validation function
  const runValidation = () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name.trim()) errors.push('Strategy name cannot be empty.');
    if (indicators.length === 0) errors.push('At least one indicator must be configured.');

    const indicatorIds = new Set(indicators.map((i) => i.id));

    // Check conditions
    const checkGroup = (g: RuleGroup, gName: string) => {
      if (!g || !g.conditions || g.conditions.length === 0) {
        warnings.push(`${gName} group has no active conditions.`);
        return;
      }
      for (const item of g.conditions) {
        if ('operator' in item) {
          checkGroup(item as RuleGroup, `${gName} -> Subgroup`);
        } else {
          const rule = item as ConditionRule;
          if (rule.left.type === 'INDICATOR' && rule.left.indicatorId && !indicatorIds.has(rule.left.indicatorId)) {
            errors.push(`Condition in ${gName} references undefined indicator '${rule.left.indicatorId}'.`);
          }
          if (rule.right?.type === 'INDICATOR' && rule.right.indicatorId && !indicatorIds.has(rule.right.indicatorId)) {
            errors.push(`Condition in ${gName} references undefined indicator '${rule.right.indicatorId}'.`);
          }
        }
      }
    };

    if (direction === TradeDirection.BULLISH || direction === TradeDirection.BOTH) {
      checkGroup(bullishEntry, 'Bullish Entry');
    }
    if (direction === TradeDirection.BEARISH || direction === TradeDirection.BOTH) {
      checkGroup(bearishEntry, 'Bearish Entry');
    }

    if (Number(stopLossPoints) <= 0) warnings.push('Protective Stop-Loss should be greater than 0 points.');
    if (Number(targetProfitPoints) <= 0) warnings.push('Target Profit should be greater than 0 points.');

    setValidationErrors(errors);
    setValidationWarnings(warnings);
    return errors.length === 0;
  };

  // Add Indicator
  const handleAddIndicator = (type: IndicatorType) => {
    const count = indicators.filter((i) => i.type === type).length + 1;
    const newId = `${type.toLowerCase()}_${count}`;
    const newInd: StrategyIndicatorConfig = {
      id: newId,
      type,
      period: type === IndicatorType.RSI ? 14 : type === IndicatorType.EMA || type === IndicatorType.SMA ? 20 : 14,
      source: 'close',
      stdDevMultiplier: type === IndicatorType.BOLLINGER_BANDS ? 2 : undefined,
    };
    setIndicators([...indicators, newInd]);
  };

  // Remove Indicator
  const handleRemoveIndicator = (id: string) => {
    // Check if referenced
    const isReferencedInBull = JSON.stringify(bullishEntry).includes(id);
    const isReferencedInBear = JSON.stringify(bearishEntry).includes(id);
    if (isReferencedInBull || isReferencedInBear) {
      alert(`Cannot delete indicator '${id}' because it is currently used by entry rules. Please remove conditions referencing it first.`);
      return;
    }
    setIndicators(indicators.filter((i) => i.id !== id));
  };

  // Add Condition to group
  const handleAddCondition = (target: 'BULLISH' | 'BEARISH') => {
    const firstInd = indicators[0]?.id || 'ema_fast';
    const newCond: ConditionRule = {
      id: `cond_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      left: { type: 'INDICATOR', indicatorId: firstInd, offset: 0 },
      comparison: ComparisonOperator.GT,
      right: { type: 'NUMBER', value: 50 },
      enabled: true,
      description: 'New Condition',
    };

    if (target === 'BULLISH') {
      setBullishEntry({
        ...bullishEntry,
        conditions: [...bullishEntry.conditions, newCond],
      });
    } else {
      setBearishEntry({
        ...bearishEntry,
        conditions: [...bearishEntry.conditions, newCond],
      });
    }
  };

  // Remove Condition
  const handleRemoveCondition = (target: 'BULLISH' | 'BEARISH', condId: string) => {
    if (target === 'BULLISH') {
      setBullishEntry({
        ...bullishEntry,
        conditions: bullishEntry.conditions.filter((c: any) => c.id !== condId),
      });
    } else {
      setBearishEntry({
        ...bearishEntry,
        conditions: bearishEntry.conditions.filter((c: any) => c.id !== condId),
      });
    }
  };

  // Construct final StrategyConfig
  const buildConfig = (isDraft = false): Partial<StrategyConfig> => {
    const astConfig: StrategyAstConfig = {
      category,
      direction,
      indicators,
      bullishEntry,
      bearishEntry,
      entryRules: {
        candleCloseConfirmation: true,
        confirmingCandles: 1,
        cooldownBars: 2,
      },
      contractSelection: {
        instrumentType,
        optionSide: direction === TradeDirection.BULLISH ? 'LONG_CE' : direction === TradeDirection.BEARISH ? 'LONG_PE' : 'BOTH',
        underlying,
        expiry,
        strikeSelection,
        minPremium: Number(minPremium) || 20,
        maxPremium: Number(maxPremium) || 400,
        maxBidAskSpreadPct: Number(maxBidAskSpreadPct) || 1.5,
      },
      exitRules: {
        stopLossBasis: 'OPTION_PREMIUM',
        stopLossValue: Number(stopLossPoints) || 8,
        targetProfitBasis: 'OPTION_PREMIUM',
        targetProfitValue: Number(targetProfitPoints) || 16,
        exitOnOppositeSignal,
        marketCutoffTime: marketCutoff,
      },
      trailingProfit: {
        enabled: useTrailing,
        mode: trailingMode,
        activationProfitInr: Number(trailingActivationProfit) || 150,
        adjustmentStepInr: Number(trailingStep) || 50,
      },
    };

    return {
      id: initialStrategy?.id,
      name: name.trim() || 'Visual Strategy',
      description: description.trim(),
      category,
      underlying,
      timeframe,
      market: 'NSE_FO',
      status: isDraft ? StrategyStatus.DRAFT : StrategyStatus.PAPER_ACTIVE,
      tradeMode: TradeMode.PAPER,
      allowedInstruments: [AllowedOptionType.LONG_CALL, AllowedOptionType.LONG_PUT],
      session: {
        start: sessionStart,
        lastEntry: sessionLastEntry,
        timezone: 'Asia/Kolkata',
      },
      exit: {
        stopBasis: 'OPTION_PREMIUM',
        stopLossPoints: Number(stopLossPoints) || 8,
        targetPoints: Number(targetProfitPoints) || 16,
        marketCutoff,
      },
      risk: {
        maxCapitalInr: Number(maxCapitalInr) || 10000,
        maxAllInTradeLossInr: Number(maxAllInTradeLossInr) || 200,
        maxAllInDailyLossInr: (Number(maxAllInTradeLossInr) || 200) * 3,
        maxOpenPositions: 1,
        maxTradesPerDay: Number(maxTradesPerDay) || 3,
        targetNetProfitInr: Number(targetNetProfitInr) || 300,
        maxRoundTripCostBudgetInr: 60,
      },
      maxCapitalInr: Number(maxCapitalInr) || 10000,
      maxAllInTradeLossInr: Number(maxAllInTradeLossInr) || 200,
      maxAllInDailyLossInr: (Number(maxAllInTradeLossInr) || 200) * 3,
      targetNetProfitInr: Number(targetNetProfitInr) || 300,
      astConfig,
      requiresApproval: true,
    };
  };

  const handleSave = async (isDraft = false) => {
    if (!isDraft && !runValidation()) {
      setActiveTab('PREVIEW');
      return;
    }
    setIsSaving(true);
    try {
      const config = buildConfig(isDraft);
      await onSave(config, isDraft);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleBacktest = () => {
    runValidation();
    const config = buildConfig(false);
    onBacktest(config);
    onClose();
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.md,
        }}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: borderRadius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            width: '100%',
            maxWidth: 1040,
            maxHeight: '94%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <View
            style={{
              padding: spacing.md,
              borderBottomWidth: 1,
              borderColor: colors.border,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View>
              <Text style={{ ...typography.h3, color: colors.text, fontWeight: '700' }}>
                Visual Rule Builder (No-Code Strategy Lab)
              </Text>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, marginTop: 2 }}>
                Build quantitative strategies with modular condition blocks, indicators, and logical groups
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.textMuted, fontSize: 22, fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Builder Navigation Tabs */}
          <View
            style={{
              flexDirection: 'row',
              borderBottomWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              paddingHorizontal: spacing.sm,
            }}
          >
            {[
              { id: 'DETAILS', label: '1. Strategy Details' },
              { id: 'INDICATORS', label: '2. Indicator Library' },
              { id: 'ENTRY_RULES', label: '3. Entry Rules' },
              { id: 'EXITS', label: '4. Exit & Trailing' },
              { id: 'CONTRACTS', label: '5. Contract Rules' },
              { id: 'PREVIEW', label: '6. Preview & Validate' },
            ].map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => {
                  if (t.id === 'PREVIEW') runValidation();
                  setActiveTab(t.id as any);
                }}
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderBottomWidth: 2,
                  borderColor: activeTab === t.id ? colors.primary : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: activeTab === t.id ? colors.primary : colors.textMuted,
                    fontSize: 12,
                    fontWeight: activeTab === t.id ? '700' : '500',
                  }}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab Body */}
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {/* TAB 1: DETAILS */}
            {activeTab === 'DETAILS' && (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                  <View style={{ flex: 1, minWidth: 260 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Strategy Name
                    </Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      style={{
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: borderRadius.sm,
                        padding: spacing.sm,
                        color: colors.text,
                      }}
                    />
                  </View>

                  <View style={{ width: 140 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Underlying
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['NIFTY', 'BANKNIFTY'] as const).map((u) => (
                        <TouchableOpacity
                          key={u}
                          onPress={() => setUnderlying(u)}
                          style={{
                            flex: 1,
                            backgroundColor: underlying === u ? colors.primary : colors.background,
                            borderWidth: 1,
                            borderColor: underlying === u ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: underlying === u ? '#fff' : colors.text, fontSize: 11, fontWeight: '700' }}>
                            {u}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ width: 160 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Trade Direction
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {[TradeDirection.BOTH, TradeDirection.BULLISH, TradeDirection.BEARISH].map((d) => (
                        <TouchableOpacity
                          key={d}
                          onPress={() => setDirection(d)}
                          style={{
                            flex: 1,
                            backgroundColor: direction === d ? colors.primary : colors.background,
                            borderWidth: 1,
                            borderColor: direction === d ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: direction === d ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {d}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ width: 140 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Timeframe
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {(['1m', '5m', '15m'] as const).map((tf) => (
                        <TouchableOpacity
                          key={tf}
                          onPress={() => setTimeframe(tf)}
                          style={{
                            flex: 1,
                            backgroundColor: timeframe === tf ? colors.primary : colors.background,
                            borderWidth: 1,
                            borderColor: timeframe === tf ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: timeframe === tf ? '#fff' : colors.text, fontSize: 11, fontWeight: '700' }}>
                            {tf}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                <View>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Strategy Thesis / Description
                  </Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    placeholder="Describe how this strategy seeks edge in the market..."
                    placeholderTextColor={colors.textMuted}
                    style={{
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: borderRadius.sm,
                      padding: spacing.sm,
                      color: colors.text,
                      minHeight: 60,
                    }}
                  />
                </View>

                {/* Session Hours */}
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: spacing.sm,
                  }}
                >
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Session Hours & Safety Gates (IST)
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Session Start</Text>
                      <TextInput
                        value={sessionStart}
                        onChangeText={setSessionStart}
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Last Permitted Entry</Text>
                      <TextInput
                        value={sessionLastEntry}
                        onChangeText={setSessionLastEntry}
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Intraday Cutoff Exit</Text>
                      <TextInput
                        value={marketCutoff}
                        onChangeText={setMarketCutoff}
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                  </View>
                </View>

                {/* Category & Strategy Classification */}
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: spacing.sm,
                  }}
                >
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Strategy Category
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {['MOMENTUM', 'TREND_FOLLOWING', 'BREAKOUT', 'REVERSAL', 'VOLATILITY'].map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => setCategory(cat)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: borderRadius.sm,
                          backgroundColor: category === cat ? colors.primary : colors.surface,
                          borderWidth: 1,
                          borderColor: category === cat ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={{ color: category === cat ? '#fff' : colors.text, fontSize: 11, fontWeight: '600' }}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Capital & Trade Limits */}
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: spacing.sm,
                  }}
                >
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Capital & Trade Guardrails
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                    <View style={{ flex: 1, minWidth: 130 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Max Capital (₹)</Text>
                      <TextInput
                        value={maxCapitalInr}
                        onChangeText={setMaxCapitalInr}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 130 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Max Loss / Trade (₹)</Text>
                      <TextInput
                        value={maxAllInTradeLossInr}
                        onChangeText={setMaxAllInTradeLossInr}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 130 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Target Net Profit (₹)</Text>
                      <TextInput
                        value={targetNetProfitInr}
                        onChangeText={setTargetNetProfitInr}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 130 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>Max Trades / Day</Text>
                      <TextInput
                        value={maxTradesPerDay}
                        onChangeText={setMaxTradesPerDay}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                        }}
                      />
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* TAB 2: INDICATORS */}
            {activeTab === 'INDICATORS' && (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Active Indicator Library ({indicators.length})
                  </Text>

                  {/* Add indicator buttons */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      IndicatorType.EMA,
                      IndicatorType.SMA,
                      IndicatorType.RSI,
                      IndicatorType.VWAP,
                      IndicatorType.BOLLINGER_BANDS,
                      IndicatorType.MACD,
                      IndicatorType.ATR,
                      IndicatorType.ADX,
                      IndicatorType.VOLUME,
                    ].map((type) => (
                      <TouchableOpacity
                        key={type}
                        onPress={() => handleAddIndicator(type)}
                        style={{
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          borderColor: colors.primary,
                          borderWidth: 1,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 4,
                        }}
                      >
                        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>
                          + {type}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Indicator cards */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                  {indicators.map((ind, idx) => (
                    <View
                      key={ind.id}
                      style={{
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: borderRadius.md,
                        padding: spacing.md,
                        width: '48%',
                        minWidth: 260,
                        gap: 8,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ ...typography.bodySm, color: colors.primary, fontWeight: '800' }}>
                            {ind.id}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.textMuted }}>({ind.type})</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleRemoveIndicator(ind.id)}
                          style={{ padding: 4 }}
                        >
                          <Text style={{ color: colors.error, fontSize: 13, fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Parameters */}
                      {ind.period !== undefined && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 11, color: colors.textMuted, width: 80 }}>Period:</Text>
                          <TextInput
                            value={String(ind.period)}
                            onChangeText={(v) => {
                              const copy = [...indicators];
                              if (copy[idx]) {
                                copy[idx]!.period = Number(v) || ind.period;
                                setIndicators(copy);
                              }
                            }}
                            keyboardType="numeric"
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: 4,
                              padding: 4,
                              color: colors.text,
                              fontSize: 12,
                              flex: 1,
                            }}
                          />
                        </View>
                      )}

                      {ind.stdDevMultiplier !== undefined && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 11, color: colors.textMuted, width: 80 }}>StdDev Mult:</Text>
                          <TextInput
                            value={String(ind.stdDevMultiplier)}
                            onChangeText={(v) => {
                              const copy = [...indicators];
                              if (copy[idx]) {
                                copy[idx]!.stdDevMultiplier = Number(v) || ind.stdDevMultiplier;
                                setIndicators(copy);
                              }
                            }}
                            keyboardType="numeric"
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: 4,
                              padding: 4,
                              color: colors.text,
                              fontSize: 12,
                              flex: 1,
                            }}
                          />
                        </View>
                      )}

                      {ind.source !== undefined && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 11, color: colors.textMuted, width: 80 }}>Source:</Text>
                          <View style={{ flexDirection: 'row', gap: 4, flex: 1 }}>
                            {['close', 'open', 'high', 'low'].map((s) => (
                              <TouchableOpacity
                                key={s}
                                onPress={() => {
                                  const copy = [...indicators];
                                  if (copy[idx]) {
                                    copy[idx]!.source = s as any;
                                    setIndicators(copy);
                                  }
                                }}
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  backgroundColor: ind.source === s ? colors.primary : colors.surface,
                                  borderRadius: 4,
                                }}
                              >
                                <Text style={{ color: ind.source === s ? '#fff' : colors.textMuted, fontSize: 10 }}>
                                  {s}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* TAB 3: ENTRY RULES */}
            {activeTab === 'ENTRY_RULES' && (
              <View style={{ gap: spacing.lg }}>
                {/* Bullish Entry Group */}
                {(direction === TradeDirection.BOTH || direction === TradeDirection.BULLISH) && (
                  <View
                    style={{
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: 'rgba(16, 185, 129, 0.3)',
                      borderRadius: borderRadius.md,
                      padding: spacing.md,
                      gap: spacing.sm,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ ...typography.h4, color: colors.success, fontWeight: '700' }}>
                          🟢 Bullish Entry Rules (Long Call / CE)
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {[LogicalOperator.AND, LogicalOperator.OR].map((op) => (
                            <TouchableOpacity
                              key={op}
                              onPress={() => setBullishEntry({ ...bullishEntry, operator: op })}
                              style={{
                                backgroundColor: bullishEntry.operator === op ? colors.success : colors.surface,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: 4,
                              }}
                            >
                              <Text style={{ color: bullishEntry.operator === op ? '#fff' : colors.textMuted, fontSize: 10, fontWeight: '700' }}>
                                {op}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => handleAddCondition('BULLISH')}
                        style={{
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          borderColor: colors.success,
                          borderWidth: 1,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 4,
                        }}
                      >
                        <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>+ Add Condition</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Conditions rows */}
                    {bullishEntry.conditions.map((item: any, cIdx: number) => {
                      const rule = item as ConditionRule;
                      return (
                        <View
                          key={rule.id}
                          style={{
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: borderRadius.sm,
                            padding: spacing.sm,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: spacing.sm,
                          }}
                        >
                          <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700' }}>
                            #{cIdx + 1}
                          </Text>

                          {/* Left Operand Selector */}
                          <View style={{ minWidth: 130 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Left Operand:</Text>
                            <TextInput
                              value={rule.left?.indicatorId || rule.left?.field || 'close'}
                              onChangeText={(v) => {
                                const copy = { ...bullishEntry };
                                (copy.conditions[cIdx] as any).left.indicatorId = v;
                                setBullishEntry(copy);
                              }}
                              style={{
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 4,
                                padding: 4,
                                color: colors.text,
                                fontSize: 11,
                              }}
                            />
                          </View>

                          {/* Operator */}
                          <View style={{ minWidth: 120 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Comparison:</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                              {[ComparisonOperator.GT, ComparisonOperator.LT, ComparisonOperator.CROSSES_ABOVE, ComparisonOperator.CROSSES_BELOW].map((op) => (
                                <TouchableOpacity
                                  key={op}
                                  onPress={() => {
                                    const copy = { ...bullishEntry };
                                    (copy.conditions[cIdx] as any).comparison = op;
                                    setBullishEntry(copy);
                                  }}
                                  style={{
                                    backgroundColor: rule.comparison === op ? colors.primary : colors.background,
                                    paddingHorizontal: 4,
                                    paddingVertical: 2,
                                    borderRadius: 3,
                                  }}
                                >
                                  <Text style={{ color: rule.comparison === op ? '#fff' : colors.textMuted, fontSize: 9 }}>
                                    {op}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>

                          {/* Right Operand */}
                          <View style={{ minWidth: 120 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Right Operand:</Text>
                            <TextInput
                              value={rule.right?.indicatorId || (rule.right?.value !== undefined ? String(rule.right.value) : '')}
                              onChangeText={(v) => {
                                const copy = { ...bullishEntry };
                                const isNum = !isNaN(Number(v)) && v.trim() !== '';
                                if (isNum) {
                                  (copy.conditions[cIdx] as any).right = { type: 'NUMBER', value: Number(v) };
                                } else {
                                  (copy.conditions[cIdx] as any).right = { type: 'INDICATOR', indicatorId: v };
                                }
                                setBullishEntry(copy);
                              }}
                              style={{
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 4,
                                padding: 4,
                                color: colors.text,
                                fontSize: 11,
                              }}
                            />
                          </View>

                          <TouchableOpacity
                            onPress={() => handleRemoveCondition('BULLISH', rule.id)}
                            style={{ padding: 4, marginLeft: 'auto' }}
                          >
                            <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Bearish Entry Group */}
                {(direction === TradeDirection.BOTH || direction === TradeDirection.BEARISH) && (
                  <View
                    style={{
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      borderRadius: borderRadius.md,
                      padding: spacing.md,
                      gap: spacing.sm,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ ...typography.h4, color: colors.error, fontWeight: '700' }}>
                          🔴 Bearish Entry Rules (Long Put / PE)
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {[LogicalOperator.AND, LogicalOperator.OR].map((op) => (
                            <TouchableOpacity
                              key={op}
                              onPress={() => setBearishEntry({ ...bearishEntry, operator: op })}
                              style={{
                                backgroundColor: bearishEntry.operator === op ? colors.error : colors.surface,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: 4,
                              }}
                            >
                              <Text style={{ color: bearishEntry.operator === op ? '#fff' : colors.textMuted, fontSize: 10, fontWeight: '700' }}>
                                {op}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => handleAddCondition('BEARISH')}
                        style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.15)',
                          borderColor: colors.error,
                          borderWidth: 1,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 4,
                        }}
                      >
                        <Text style={{ color: colors.error, fontSize: 11, fontWeight: '700' }}>+ Add Condition</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Conditions rows */}
                    {bearishEntry.conditions.map((item: any, cIdx: number) => {
                      const rule = item as ConditionRule;
                      return (
                        <View
                          key={rule.id}
                          style={{
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: borderRadius.sm,
                            padding: spacing.sm,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: spacing.sm,
                          }}
                        >
                          <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700' }}>
                            #{cIdx + 1}
                          </Text>

                          {/* Left Operand Selector */}
                          <View style={{ minWidth: 130 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Left Operand:</Text>
                            <TextInput
                              value={rule.left?.indicatorId || rule.left?.field || 'close'}
                              onChangeText={(v) => {
                                const copy = { ...bearishEntry };
                                (copy.conditions[cIdx] as any).left.indicatorId = v;
                                setBearishEntry(copy);
                              }}
                              style={{
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 4,
                                padding: 4,
                                color: colors.text,
                                fontSize: 11,
                              }}
                            />
                          </View>

                          {/* Operator */}
                          <View style={{ minWidth: 120 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Comparison:</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                              {[ComparisonOperator.GT, ComparisonOperator.LT, ComparisonOperator.CROSSES_ABOVE, ComparisonOperator.CROSSES_BELOW].map((op) => (
                                <TouchableOpacity
                                  key={op}
                                  onPress={() => {
                                    const copy = { ...bearishEntry };
                                    (copy.conditions[cIdx] as any).comparison = op;
                                    setBearishEntry(copy);
                                  }}
                                  style={{
                                    backgroundColor: rule.comparison === op ? colors.primary : colors.background,
                                    paddingHorizontal: 4,
                                    paddingVertical: 2,
                                    borderRadius: 3,
                                  }}
                                >
                                  <Text style={{ color: rule.comparison === op ? '#fff' : colors.textMuted, fontSize: 9 }}>
                                    {op}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>

                          {/* Right Operand */}
                          <View style={{ minWidth: 120 }}>
                            <Text style={{ fontSize: 9, color: colors.textMuted }}>Right Operand:</Text>
                            <TextInput
                              value={rule.right?.indicatorId || (rule.right?.value !== undefined ? String(rule.right.value) : '')}
                              onChangeText={(v) => {
                                const copy = { ...bearishEntry };
                                const isNum = !isNaN(Number(v)) && v.trim() !== '';
                                if (isNum) {
                                  (copy.conditions[cIdx] as any).right = { type: 'NUMBER', value: Number(v) };
                                } else {
                                  (copy.conditions[cIdx] as any).right = { type: 'INDICATOR', indicatorId: v };
                                }
                                setBearishEntry(copy);
                              }}
                              style={{
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 4,
                                padding: 4,
                                color: colors.text,
                                fontSize: 11,
                              }}
                            />
                          </View>

                          <TouchableOpacity
                            onPress={() => handleRemoveCondition('BEARISH', rule.id)}
                            style={{ padding: 4, marginLeft: 'auto' }}
                          >
                            <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* TAB 4: EXITS & TRAILING */}
            {activeTab === 'EXITS' && (
              <View style={{ gap: spacing.md }}>
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: spacing.md,
                  }}
                >
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Protective Stops & Profit Targets
                  </Text>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                        Stop Loss (Option Points)
                      </Text>
                      <TextInput
                        value={stopLossPoints}
                        onChangeText={setStopLossPoints}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: borderRadius.sm,
                          padding: spacing.sm,
                          color: colors.text,
                        }}
                      />
                    </View>

                    <View style={{ flex: 1, minWidth: 140 }}>
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                        Target Profit (Option Points)
                      </Text>
                      <TextInput
                        value={targetProfitPoints}
                        onChangeText={setTargetProfitPoints}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: borderRadius.sm,
                          padding: spacing.sm,
                          color: colors.text,
                        }}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Switch
                      value={exitOnOppositeSignal}
                      onValueChange={setExitOnOppositeSignal}
                    />
                    <Text style={{ color: colors.text, fontSize: 12 }}>
                      Exit active position immediately if opposite signal occurs
                    </Text>
                  </View>
                </View>

                {/* Trailing Stop section */}
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: spacing.md,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                      Dynamic Trailing Stop-Loss
                    </Text>
                    <Switch value={useTrailing} onValueChange={setUseTrailing} />
                  </View>

                  {useTrailing && (
                    <View style={{ gap: spacing.sm }}>
                      <View>
                        <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                          Trailing Calculation Mode
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {[
                            TrailingProfitMode.FIXED_STEP,
                            TrailingProfitMode.PERCENTAGE,
                            TrailingProfitMode.ATR_BASED,
                            TrailingProfitMode.PRICE_STRUCTURE,
                          ].map((m) => (
                            <TouchableOpacity
                              key={m}
                              onPress={() => setTrailingMode(m)}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: borderRadius.sm,
                                backgroundColor: trailingMode === m ? colors.primary : colors.surface,
                                borderWidth: 1,
                                borderColor: trailingMode === m ? colors.primary : colors.border,
                              }}
                            >
                              <Text
                                style={{
                                  color: trailingMode === m ? '#fff' : colors.text,
                                  fontSize: 10,
                                  fontWeight: '600',
                                }}
                              >
                                {m}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                        <View style={{ flex: 1, minWidth: 140 }}>
                          <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                            Activation Profit (₹ Net)
                          </Text>
                          <TextInput
                            value={trailingActivationProfit}
                            onChangeText={setTrailingActivationProfit}
                            keyboardType="numeric"
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: borderRadius.sm,
                              padding: spacing.sm,
                              color: colors.text,
                            }}
                          />
                        </View>

                      <View style={{ flex: 1, minWidth: 140 }}>
                        <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                          Trailing Step Lock (₹)
                        </Text>
                        <TextInput
                          value={trailingStep}
                          onChangeText={setTrailingStep}
                          keyboardType="numeric"
                          style={{
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: borderRadius.sm,
                            padding: spacing.sm,
                            color: colors.text,
                          }}
                        />
                      </View>
                    </View>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* TAB 5: CONTRACTS */}
            {activeTab === 'CONTRACTS' && (
              <View
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: borderRadius.md,
                  padding: spacing.md,
                  gap: spacing.md,
                }}
              >
                <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                  5. F&O Contract Selection Rules
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                  <View style={{ width: 140 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Instrument Type
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {(['OPTIONS', 'FUTURES'] as const).map((it) => (
                        <TouchableOpacity
                          key={it}
                          onPress={() => setInstrumentType(it)}
                          style={{
                            flex: 1,
                            backgroundColor: instrumentType === it ? colors.primary : colors.surface,
                            borderWidth: 1,
                            borderColor: instrumentType === it ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: instrumentType === it ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {it}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ width: 140 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Expiry Selection
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {[ExpirySelection.NEAREST_ELIGIBLE, ExpirySelection.NEXT_WEEK].map((exp) => (
                        <TouchableOpacity
                          key={exp}
                          onPress={() => setExpiry(exp)}
                          style={{
                            flex: 1,
                            backgroundColor: expiry === exp ? colors.primary : colors.surface,
                            borderWidth: 1,
                            borderColor: expiry === exp ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: expiry === exp ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {exp === ExpirySelection.NEAREST_ELIGIBLE ? 'Nearest' : 'Next'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ width: 140 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Strike Selection
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {[StrikeSelection.ATM, StrikeSelection.ITM, StrikeSelection.OTM].map((st) => (
                        <TouchableOpacity
                          key={st}
                          onPress={() => setStrikeSelection(st)}
                          style={{
                            flex: 1,
                            backgroundColor: strikeSelection === st ? colors.primary : colors.surface,
                            borderWidth: 1,
                            borderColor: strikeSelection === st ? colors.primary : colors.border,
                            paddingVertical: 8,
                            borderRadius: borderRadius.sm,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: strikeSelection === st ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {st}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={{ flex: 1, minWidth: 130 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Min Premium (₹)
                    </Text>
                    <TextInput
                      value={minPremium}
                      onChangeText={setMinPremium}
                      keyboardType="numeric"
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: borderRadius.sm,
                        padding: spacing.sm,
                        color: colors.text,
                      }}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 130 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Max Premium (₹)
                    </Text>
                    <TextInput
                      value={maxPremium}
                      onChangeText={setMaxPremium}
                      keyboardType="numeric"
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: borderRadius.sm,
                        padding: spacing.sm,
                        color: colors.text,
                      }}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 130 }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                      Max Spread (%)
                    </Text>
                    <TextInput
                      value={maxBidAskSpreadPct}
                      onChangeText={setMaxBidAskSpreadPct}
                      keyboardType="numeric"
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: borderRadius.sm,
                        padding: spacing.sm,
                        color: colors.text,
                      }}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* TAB 6: PREVIEW & VALIDATE */}
            {activeTab === 'PREVIEW' && (
              <View style={{ gap: spacing.md }}>
                {/* Validation status banner */}
                {validationErrors.length > 0 ? (
                  <View
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      borderColor: colors.error,
                      borderWidth: 1,
                      borderRadius: borderRadius.md,
                      padding: spacing.md,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.error, fontWeight: '700' }}>
                      ⚠️ Validation Issues Found ({validationErrors.length}):
                    </Text>
                    {validationErrors.map((err, i) => (
                      <Text key={i} style={{ color: colors.error, fontSize: 12 }}>
                        • {err}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <View
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      borderColor: colors.success,
                      borderWidth: 1,
                      borderRadius: borderRadius.md,
                      padding: spacing.md,
                    }}
                  >
                    <Text style={{ color: colors.success, fontWeight: '700' }}>
                      ✅ Strategy Logic Validated! All indicators and rules are consistent.
                    </Text>
                  </View>
                )}

                {validationWarnings.length > 0 && (
                  <View
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      borderColor: colors.warning,
                      borderWidth: 1,
                      borderRadius: borderRadius.md,
                      padding: spacing.md,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.warning, fontWeight: '700' }}>
                      Notice:
                    </Text>
                    {validationWarnings.map((w, i) => (
                      <Text key={i} style={{ color: colors.warning, fontSize: 12 }}>
                        • {w}
                      </Text>
                    ))}
                  </View>
                )}

                {/* Plain English Summary */}
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                    gap: 8,
                  }}
                >
                  <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                    Strategy Executive Summary
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.text }}>
                    <Text style={{ fontWeight: '700' }}>NAME:</Text> {name}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.text }}>
                    <Text style={{ fontWeight: '700' }}>MARKET:</Text> {underlying} ({timeframe} candles)
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.text }}>
                    <Text style={{ fontWeight: '700' }}>INDICATORS:</Text>{' '}
                    {indicators.map((i) => `${i.id} (${i.type})`).join(', ')}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.success }}>
                    <Text style={{ fontWeight: '700' }}>BULLISH ENTRY:</Text>{' '}
                    {bullishEntry.conditions.length} conditions ({bullishEntry.operator})
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.error }}>
                    <Text style={{ fontWeight: '700' }}>BEARISH ENTRY:</Text>{' '}
                    {bearishEntry.conditions.length} conditions ({bearishEntry.operator})
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>
                    <Text style={{ fontWeight: '700' }}>RISK & EXITS:</Text> SL {stopLossPoints} pts, Target {targetProfitPoints} pts, Trailing {useTrailing ? 'ON' : 'OFF'}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View
            style={{
              padding: spacing.md,
              borderTopWidth: 1,
              borderColor: colors.border,
              backgroundColor: 'rgba(0,0,0,0.2)',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: colors.surfaceHover,
                paddingVertical: 8,
                paddingHorizontal: spacing.md,
                borderRadius: borderRadius.sm,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => handleSave(true)}
                disabled={isSaving}
                style={{
                  backgroundColor: colors.surfaceHover,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>
                  Save Draft
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleBacktest}
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  borderColor: colors.success,
                  borderWidth: 1,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>
                  Backtest ⚡
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleSave(false)}
                disabled={isSaving}
                style={{
                  backgroundColor: colors.primary,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.lg,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {isSaving ? 'Saving...' : 'Save Strategy'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
