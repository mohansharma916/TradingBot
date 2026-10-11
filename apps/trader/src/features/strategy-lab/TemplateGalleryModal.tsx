import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { ALL_STRATEGY_TEMPLATES, StrategyTemplateItem } from '@trading-bot/domain';

interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCustomize: (template: StrategyTemplateItem) => void;
  onQuickClone: (template: StrategyTemplateItem) => void;
}

export function TemplateGalleryModal({
  isOpen,
  onClose,
  onSelectCustomize,
  onQuickClone,
}: TemplateGalleryModalProps) {
  if (!isOpen) return null;

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
            maxWidth: 860,
            maxHeight: '90%',
            display: 'flex',
            flexDirection: 'column',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 24,
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
                Predefined Strategy Templates
              </Text>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, marginTop: 4 }}>
                Select a validated quantitative template to customize without writing code
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.textMuted, fontSize: 22, fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Templates Grid / List */}
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {ALL_STRATEGY_TEMPLATES.map((tpl) => {
              const indicators = tpl.astConfig.indicators || [];
              const categoryColor =
                tpl.category === 'TREND'
                  ? colors.primary
                  : tpl.category === 'MOMENTUM'
                  ? colors.accent
                  : tpl.category === 'BREAKOUT'
                  ? '#ec4899'
                  : colors.warning;

              return (
                <View
                  key={tpl.id}
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: borderRadius.md,
                    padding: spacing.md,
                  }}
                >
                  {/* Top row */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: spacing.xs,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: spacing.md }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                        <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                          {tpl.name}
                        </Text>
                        <View
                          style={{
                            backgroundColor: `${categoryColor}20`,
                            borderColor: categoryColor,
                            borderWidth: 1,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: borderRadius.sm,
                          }}
                        >
                          <Text style={{ color: categoryColor, fontSize: 10, fontWeight: '700' }}>
                            {tpl.category}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ ...typography.bodySm, color: colors.textMuted, lineHeight: 18 }}>
                        {tpl.description}
                      </Text>
                    </View>

                    {/* Instrument and Timeframe badges */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Badge label={tpl.recommendedUnderlying} variant="neutral" />
                      <Badge label={tpl.recommendedTimeframe} variant="neutral" />
                    </View>
                  </View>

                  {/* Indicators row */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: spacing.sm }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, alignSelf: 'center', marginRight: 4 }}>
                      Indicators:
                    </Text>
                    {indicators.map((ind) => (
                      <View
                        key={ind.id}
                        style={{
                          backgroundColor: colors.surfaceHover,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 4,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: colors.text, fontWeight: '600' }}>
                          {ind.type} {ind.period ? `(${ind.period})` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Conditions Preview */}
                  <View
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: borderRadius.sm,
                      padding: spacing.sm,
                      marginVertical: spacing.xs,
                      gap: 4,
                    }}
                  >
                    {tpl.astConfig.bullishEntry?.description && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>BULLISH (CE):</Text>
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{tpl.astConfig.bullishEntry.description}</Text>
                      </View>
                    )}
                    {tpl.astConfig.bearishEntry?.description && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.error, fontSize: 11, fontWeight: '700' }}>BEARISH (PE):</Text>
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{tpl.astConfig.bearishEntry.description}</Text>
                      </View>
                    )}
                  </View>

                  {/* Action buttons */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                      gap: spacing.sm,
                      marginTop: spacing.sm,
                      paddingTop: spacing.xs,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        onClose();
                        onQuickClone(tpl);
                      }}
                      style={{
                        backgroundColor: colors.surfaceHover,
                        paddingVertical: 7,
                        paddingHorizontal: spacing.md,
                        borderRadius: borderRadius.sm,
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                        Quick Clone & Save
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        onClose();
                        onSelectCustomize(tpl);
                      }}
                      style={{
                        backgroundColor: colors.primary,
                        paddingVertical: 7,
                        paddingHorizontal: spacing.md,
                        borderRadius: borderRadius.sm,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                        Customize Template →
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Footer note */}
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
            <Text style={{ ...typography.caption, color: colors.textMuted }}>
              * All templates are starting points. Customize parameters and run backtests before trading.
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: colors.surfaceHover,
                paddingVertical: 6,
                paddingHorizontal: spacing.md,
                borderRadius: borderRadius.sm,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
