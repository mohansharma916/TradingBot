import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';

interface CreateChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: () => void;
  onSelectNoCode: () => void;
}

export function CreateChoiceModal({
  isOpen,
  onClose,
  onSelectTemplate,
  onSelectNoCode,
}: CreateChoiceModalProps) {
  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
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
            maxWidth: 540,
            padding: spacing.lg,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.5,
            shadowRadius: 20,
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <View>
              <Text style={{ ...typography.h3, color: colors.text, fontWeight: '700' }}>
                Create Trading Strategy
              </Text>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, marginTop: 4 }}>
                Choose how you want to build your quantitative strategy
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.textMuted, fontSize: 20, fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Options Grid */}
          <View style={{ gap: spacing.md, marginVertical: spacing.md }}>
            {/* Option A: Predefined Template */}
            <TouchableOpacity
              onPress={() => {
                onClose();
                onSelectTemplate();
              }}
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                borderWidth: 1.5,
                borderColor: colors.primary,
                borderRadius: borderRadius.md,
                padding: spacing.lg,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 }}>
                <View
                  style={{
                    backgroundColor: colors.primary,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>A</Text>
                </View>
                <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                  Start from Template
                </Text>
                <View style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 'auto' }}>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>RECOMMENDED</Text>
                </View>
              </View>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, lineHeight: 20 }}>
                Pick from 6 quantitative templates (Trend Following, EMA Crossover, RSI Reversal, VWAP Momentum, ORB, Bollinger Breakout). Customize indicators, timeframe, and risk limits in seconds.
              </Text>
            </TouchableOpacity>

            {/* Option B: Build from Scratch (No-Code) */}
            <TouchableOpacity
              onPress={() => {
                onClose();
                onSelectNoCode();
              }}
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                borderWidth: 1.5,
                borderColor: colors.success,
                borderRadius: borderRadius.md,
                padding: spacing.lg,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 }}>
                <View
                  style={{
                    backgroundColor: colors.success,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>B</Text>
                </View>
                <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
                  Build from Scratch (No-Code)
                </Text>
                <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 'auto' }}>
                  <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>VISUAL BUILDER</Text>
                </View>
              </View>
              <Text style={{ ...typography.bodySm, color: colors.textMuted, lineHeight: 20 }}>
                Visual rule designer using condition blocks (`Left | Operator | Right`), indicator library (SMA, EMA, RSI, MACD, BB, ATR), nested AND/OR/NOT groups, F&O contract rules, and trailing profit locks. Zero code required.
              </Text>
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.sm }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: colors.surfaceHover,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.lg,
                borderRadius: borderRadius.md,
              }}
            >
              <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
