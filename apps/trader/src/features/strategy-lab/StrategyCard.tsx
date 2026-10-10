import { View, Text, TouchableOpacity } from 'react-native';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import { StrategyConfig, StrategyStatus } from '@trading-bot/contracts';

interface StrategyCardProps {
  strategy: StrategyConfig;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onArchive: () => void;
  onUseInDailyBot: () => void;
  onHistory?: () => void;
  onScan?: () => void;
}

export function StrategyCard({
  strategy,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate,
  onTest,
  onArchive,
  onUseInDailyBot,
  onHistory,
  onScan,
}: StrategyCardProps) {
  // Extract indicators
  const indicators = strategy.astConfig?.indicators?.map((i) => `${i.type} ${i.period ? `(${i.period})` : ''}`) || [
    `EMA (${strategy.entry?.emaPeriod ?? 20})`,
    `RSI (${strategy.entry?.rsiPeriod ?? 14})`,
  ];

  // Status color
  const statusColor =
    strategy.status === StrategyStatus.APPROVAL_READY || strategy.status === StrategyStatus.AUTO_ELIGIBLE
      ? colors.success
      : strategy.status === StrategyStatus.PAPER_ACTIVE
      ? colors.primary
      : strategy.status === StrategyStatus.BACKTESTED
      ? colors.accent
      : strategy.status === StrategyStatus.ARCHIVED || strategy.status === StrategyStatus.RETIRED
      ? colors.textMuted
      : colors.warning;

  const isArchived = strategy.status === StrategyStatus.ARCHIVED || strategy.status === StrategyStatus.RETIRED || strategy.isArchived;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: isSelected ? colors.primary : colors.border,
        borderRadius: borderRadius.md,
        padding: spacing.md,
        gap: spacing.sm,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isSelected ? 0.3 : 0.1,
        shadowRadius: 6,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <TouchableOpacity onPress={onSelect} style={{ flex: 1, marginRight: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ ...typography.h4, color: colors.text, fontWeight: '700' }}>
              {strategy.name}
            </Text>
            <View
              style={{
                backgroundColor: `${statusColor}18`,
                borderColor: statusColor,
                borderWidth: 1,
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: borderRadius.sm,
              }}
            >
              <Text style={{ color: statusColor, fontSize: 10, fontWeight: '700' }}>
                {strategy.status || 'DRAFT'}
              </Text>
            </View>
            <View style={{ backgroundColor: colors.surfaceHover, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '600' }}>v{strategy.version}</Text>
            </View>
          </View>

          {strategy.description && (
            <Text
              style={{ ...typography.bodySm, color: colors.textMuted, marginTop: 4, lineHeight: 18 }}
              numberOfLines={2}
            >
              {strategy.description}
            </Text>
          )}
        </TouchableOpacity>

        {/* Instruments and Timeframe */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Badge label={strategy.underlying || 'NIFTY'} variant="neutral" />
          <Badge label={strategy.timeframe || '5m'} variant="neutral" />
        </View>
      </View>

      {/* Indicator badges */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 2 }}>
        {indicators.map((ind, i) => (
          <View
            key={i}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
            }}
          >
            <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600' }}>
              {ind}
            </Text>
          </View>
        ))}
      </View>

      {/* Performance Summary (Risk caps & Target metrics) */}
      <View
        style={{
          backgroundColor: colors.background,
          borderRadius: borderRadius.sm,
          padding: spacing.sm,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Target Net Profit</Text>
          <Text style={{ fontSize: 12, color: colors.success, fontWeight: '700' }}>
            +₹{strategy.risk?.targetNetProfitInr ?? strategy.targetNetProfitInr ?? 300}
          </Text>
        </View>

        <View>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Max Trade Loss</Text>
          <Text style={{ fontSize: 12, color: colors.error, fontWeight: '700' }}>
            -₹{strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 200}
          </Text>
        </View>

        <View>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Max Capital</Text>
          <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>
            ₹{strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? 10000}
          </Text>
        </View>

        <View>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Max Trades/Day</Text>
          <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>
            {strategy.risk?.maxTradesPerDay ?? 3}
          </Text>
        </View>
      </View>

      {/* Actions Toolbar */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: spacing.xs,
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingTop: spacing.sm,
          marginTop: spacing.xs,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity
            onPress={onTest}
            style={{
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              borderColor: colors.primary,
              borderWidth: 1,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: borderRadius.sm,
            }}
          >
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>
              ⚡ Backtest
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onEdit}
            style={{
              backgroundColor: colors.surfaceHover,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: borderRadius.sm,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>
              Edit
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onDuplicate}
            style={{
              backgroundColor: colors.surfaceHover,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: borderRadius.sm,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
              Duplicate
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onArchive}
            style={{
              backgroundColor: colors.surfaceHover,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: borderRadius.sm,
            }}
          >
            <Text style={{ color: isArchived ? colors.primary : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
              {isArchived ? 'Restore' : 'Archive'}
            </Text>
          </TouchableOpacity>

          {onHistory && (
            <TouchableOpacity
              onPress={onHistory}
              style={{
                backgroundColor: colors.surfaceHover,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: borderRadius.sm,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                History
              </Text>
            </TouchableOpacity>
          )}

          {onScan && (
            <TouchableOpacity
              onPress={onScan}
              style={{
                backgroundColor: colors.surfaceHover,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: borderRadius.sm,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                Scan
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Daily Bot Action */}
        {!isArchived && (
          <TouchableOpacity
            onPress={onUseInDailyBot}
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.18)',
              borderColor: colors.success,
              borderWidth: 1,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: borderRadius.sm,
            }}
          >
            <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>
              Select for Daily Bot →
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
