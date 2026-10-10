import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { StrategyTemplateItem } from '@trading-bot/domain';
import {
  AllowedOptionType,
  StrategyConfig,
  StrategyStatus,
  TradeMode,
  StrategyAstConfig,
} from '@trading-bot/contracts';

interface TemplateCustomizerModalProps {
  isOpen: boolean;
  template: StrategyTemplateItem | null;
  onClose: () => void;
  onSave: (config: Partial<StrategyConfig>, isDraft?: boolean) => Promise<void>;
  onBacktest: (config: Partial<StrategyConfig>) => void;
}

export function TemplateCustomizerModal({
  isOpen,
  template,
  onClose,
  onSave,
  onBacktest,
}: TemplateCustomizerModalProps) {
  if (!isOpen || !template) return null;

  // Local editable state
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [underlying, setUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>(template.recommendedUnderlying);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m'>(template.recommendedTimeframe);
  const [sessionStart, setSessionStart] = useState('09:25');
  const [sessionLastEntry, setSessionLastEntry] = useState('14:45');
  const [marketCutoff, setMarketCutoff] = useState('15:10');

  // Indicators copy
  const [indicators, setIndicators] = useState(
    JSON.parse(JSON.stringify(template.astConfig.indicators || []))
  );

  // Risk limits
  const [maxCapitalInr, setMaxCapitalInr] = useState(
    String(template.defaultConfig.maxCapitalInr ?? 10000)
  );
  const [maxAllInTradeLossInr, setMaxAllInTradeLossInr] = useState(
    String(template.defaultConfig.maxAllInTradeLossInr ?? 200)
  );
  const [targetNetProfitInr, setTargetNetProfitInr] = useState(
    String(template.defaultConfig.targetNetProfitInr ?? 300)
  );
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(
    String(template.defaultConfig.risk?.maxTradesPerDay ?? 3)
  );

  // Exits
  const [stopLossPoints, setStopLossPoints] = useState(
    String(template.astConfig.exitRules?.stopLossValue ?? 8)
  );
  const [targetProfitPoints, setTargetProfitPoints] = useState(
    String(template.astConfig.exitRules?.targetProfitValue ?? 16)
  );

  // Trailing stop
  const [useTrailing, setUseTrailing] = useState(
    template.astConfig.trailingProfit?.enabled ?? true
  );
  const [trailingActivationProfit, setTrailingActivationProfit] = useState(
    String(template.astConfig.trailingProfit?.activationProfitInr ?? 150)
  );
  const [trailingStep, setTrailingStep] = useState(
    String(template.astConfig.trailingProfit?.adjustmentStepInr ?? 50)
  );

  // Confirmations
  const [candleCloseConfirmation, setCandleCloseConfirmation] = useState(
    template.astConfig.entryRules?.candleCloseConfirmation ?? true
  );
  const [confirmingCandles, setConfirmingCandles] = useState(
    String(template.astConfig.entryRules?.confirmingCandles ?? 1)
  );

  // Saving spinner
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Reset to original template defaults
  const handleResetToDefaults = () => {
    setName(template.name);
    setDescription(template.description);
    setUnderlying(template.recommendedUnderlying);
    setTimeframe(template.recommendedTimeframe);
    setIndicators(JSON.parse(JSON.stringify(template.astConfig.indicators || [])));
    setMaxCapitalInr(String(template.defaultConfig.maxCapitalInr ?? 10000));
    setMaxAllInTradeLossInr(String(template.defaultConfig.maxAllInTradeLossInr ?? 200));
    setTargetNetProfitInr(String(template.defaultConfig.targetNetProfitInr ?? 300));
    setMaxTradesPerDay(String(template.defaultConfig.risk?.maxTradesPerDay ?? 3));
    setStopLossPoints(String(template.astConfig.exitRules?.stopLossValue ?? 8));
    setTargetProfitPoints(String(template.astConfig.exitRules?.targetProfitValue ?? 16));
    setUseTrailing(template.astConfig.trailingProfit?.enabled ?? true);
    setTrailingActivationProfit(String(template.astConfig.trailingProfit?.activationProfitInr ?? 150));
    setTrailingStep(String(template.astConfig.trailingProfit?.adjustmentStepInr ?? 50));
    setCandleCloseConfirmation(template.astConfig.entryRules?.candleCloseConfirmation ?? true);
    setConfirmingCandles(String(template.astConfig.entryRules?.confirmingCandles ?? 1));
  };

  const buildCurrentConfig = (isDraft = false): Partial<StrategyConfig> => {
    const updatedAst: StrategyAstConfig = {
      ...template.astConfig,
      indicators,
      entryRules: {
        ...template.astConfig.entryRules,
        candleCloseConfirmation,
        confirmingCandles: Number(confirmingCandles) || 1,
      },
      exitRules: {
        ...template.astConfig.exitRules,
        stopLossValue: Number(stopLossPoints) || 8,
        targetProfitValue: Number(targetProfitPoints) || 16,
        marketCutoffTime: marketCutoff,
      },
      trailingProfit: {
        ...template.astConfig.trailingProfit,
        enabled: useTrailing,
        activationProfitInr: Number(trailingActivationProfit) || 150,
        adjustmentStepInr: Number(trailingStep) || 50,
      },
      contractSelection: {
        ...template.astConfig.contractSelection,
        underlying,
      },
    };

    return {
      name: name.trim() || template.name,
      description: description.trim(),
      category: template.category,
      templateId: template.id,
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
      astConfig: updatedAst,
      requiresApproval: true,
    };
  };

  const handleSaveStrategy = async (isDraft = false) => {
    setIsSaving(true);
    try {
      const config = buildCurrentConfig(isDraft);
      await onSave(config, isDraft);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleTriggerBacktest = () => {
    const config = buildCurrentConfig(false);
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
            maxWidth: 900,
            maxHeight: '92%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <View
            style={{
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderColor: colors.border,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View>
              <Text style={{ ...typography.h3, color: colors.text, fontWeight: '700' }}>
                Customize Strategy: {template.name}
              </Text>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, marginTop: 4 }}>
                Edit parameters to generate your personalized quantitative strategy
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.textMuted, fontSize: 22, fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body Content */}
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
            {/* Section 1: Basic details */}
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
                1. Strategy Identity & Market Instrument
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 260 }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Strategy Name
                  </Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
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

                <View style={{ width: 140 }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Underlying Index
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(['NIFTY', 'BANKNIFTY'] as const).map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => setUnderlying(u)}
                        style={{
                          flex: 1,
                          backgroundColor: underlying === u ? colors.primary : colors.surface,
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
                          backgroundColor: timeframe === tf ? colors.primary : colors.surface,
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
                  Description / Thesis
                </Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.sm,
                    padding: spacing.sm,
                    color: colors.text,
                    minHeight: 50,
                  }}
                />
              </View>
            </View>

            {/* Section 2: Indicator Parameters */}
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
                2. Configurable Indicator Parameters
              </Text>
              <Text style={{ ...typography.bodySm, color: colors.textMuted }}>
                Tune period values and multipliers used by this template's calculation engine:
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs }}>
                {indicators.map((ind: any, idx: number) => (
                  <View
                    key={ind.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: borderRadius.sm,
                      padding: spacing.sm,
                      width: 200,
                    }}
                  >
                    <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: 6 }}>
                      {ind.id.toUpperCase()} ({ind.type})
                    </Text>

                    {ind.period !== undefined && (
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, color: colors.textMuted }}>Period:</Text>
                        <TextInput
                          value={String(ind.period)}
                          onChangeText={(v) => {
                            const copy = [...indicators];
                            copy[idx].period = Number(v) || ind.period;
                            setIndicators(copy);
                          }}
                          keyboardType="numeric"
                          style={{
                            backgroundColor: colors.background,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 4,
                            padding: 4,
                            color: colors.text,
                            fontSize: 12,
                          }}
                        />
                      </View>
                    )}

                    {ind.stdDevMultiplier !== undefined && (
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, color: colors.textMuted }}>Std Dev Multiplier:</Text>
                        <TextInput
                          value={String(ind.stdDevMultiplier)}
                          onChangeText={(v) => {
                            const copy = [...indicators];
                            copy[idx].stdDevMultiplier = Number(v) || ind.stdDevMultiplier;
                            setIndicators(copy);
                          }}
                          keyboardType="numeric"
                          style={{
                            backgroundColor: colors.background,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 4,
                            padding: 4,
                            color: colors.text,
                            fontSize: 12,
                          }}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>

            {/* Section 3: Exit Protection & Trailing Profit */}
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
                3. Exit Rules & Dynamic Trailing Stop-Loss
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Stop-Loss Points (Option)
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
                    Target Profit Points (Option)
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

                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Session Start (IST)
                  </Text>
                  <TextInput
                    value={sessionStart}
                    onChangeText={setSessionStart}
                    placeholder="09:25"
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
                    Last Entry (IST)
                  </Text>
                  <TextInput
                    value={sessionLastEntry}
                    onChangeText={setSessionLastEntry}
                    placeholder="14:45"
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
                    Market Cutoff (IST)
                  </Text>
                  <TextInput
                    value={marketCutoff}
                    onChangeText={setMarketCutoff}
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

              {/* Trailing Stop settings */}
              <View
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.05)',
                  borderWidth: 1,
                  borderColor: 'rgba(59, 130, 246, 0.2)',
                  borderRadius: borderRadius.sm,
                  padding: spacing.sm,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ ...typography.bodySm, color: colors.text, fontWeight: '700' }}>
                    Enable Dynamic Trailing Stop-Loss
                  </Text>
                  <TouchableOpacity
                    onPress={() => setUseTrailing(!useTrailing)}
                    style={{
                      backgroundColor: useTrailing ? colors.success : colors.surfaceHover,
                      paddingHorizontal: 12,
                      paddingVertical: 4,
                      borderRadius: 12,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                      {useTrailing ? 'ACTIVE' : 'DISABLED'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {useTrailing && (
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>
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
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                          fontSize: 12,
                        }}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>
                        Trailing Step / Lock (₹)
                      </Text>
                      <TextInput
                        value={trailingStep}
                        onChangeText={setTrailingStep}
                        keyboardType="numeric"
                        style={{
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 4,
                          padding: 6,
                          color: colors.text,
                          fontSize: 12,
                        }}
                      />
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Section 4: Signal Confirmation & Risk Caps */}
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
                4. Confirmation & Strategy-Specific Risk Limits
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>
                    Max Capital Allocation (₹)
                  </Text>
                  <TextInput
                    value={maxCapitalInr}
                    onChangeText={setMaxCapitalInr}
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
                    Max All-In Trade Loss (₹)
                  </Text>
                  <TextInput
                    value={maxAllInTradeLossInr}
                    onChangeText={setMaxAllInTradeLossInr}
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
                    Target Net Profit (₹)
                  </Text>
                  <TextInput
                    value={targetNetProfitInr}
                    onChangeText={setTargetNetProfitInr}
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
                    Max Trades / Day
                  </Text>
                  <TextInput
                    value={maxTradesPerDay}
                    onChangeText={setMaxTradesPerDay}
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

            {/* Preview collapsible banner */}
            {showPreview && (
              <View
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  borderColor: colors.primary,
                  borderWidth: 1,
                  borderRadius: borderRadius.md,
                  padding: spacing.md,
                  gap: 4,
                }}
              >
                <Text style={{ ...typography.bodySm, color: colors.primary, fontWeight: '700', marginBottom: 4 }}>
                  STRATEGY LOGIC PREVIEW:
                </Text>
                <Text style={{ fontSize: 12, color: colors.text }}>
                  • UNDERLYING: {underlying} ({timeframe} candles)
                </Text>
                <Text style={{ fontSize: 12, color: colors.success }}>
                  • BULLISH ENTRY: {template.astConfig.bullishEntry?.description || 'N/A'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.error }}>
                  • BEARISH ENTRY: {template.astConfig.bearishEntry?.description || 'N/A'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  • EXITS: SL {stopLossPoints} pts, Target {targetProfitPoints} pts, Session Cutoff {marketCutoff} IST
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Footer Action Bar */}
          <View
            style={{
              padding: spacing.md,
              borderTopWidth: 1,
              borderColor: colors.border,
              backgroundColor: 'rgba(0,0,0,0.2)',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setShowPreview(!showPreview)}
                style={{
                  backgroundColor: colors.surfaceHover,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                  {showPreview ? 'Hide Preview' : 'Preview Conditions'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleResetToDefaults}
                style={{
                  backgroundColor: colors.surfaceHover,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '600' }}>
                  Reset Defaults
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => handleSaveStrategy(true)}
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
                onPress={handleTriggerBacktest}
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
                  Backtest Now ⚡
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleSaveStrategy(false)}
                disabled={isSaving}
                style={{
                  backgroundColor: colors.primary,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.lg,
                  borderRadius: borderRadius.sm,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {isSaving ? 'Saving...' : 'Save as My Strategy'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
