import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AutopilotRotation, AutopilotStatus, AutopilotTemplate, DailyBotToday, StrategyStatus } from '@trading-bot/contracts';
import { formatErrorMessage } from '@trading-bot/client-sdk';
import { colors } from '@trading-bot/ui';
import { apiClient } from '../../services/api';

const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const UNAUTHORIZED = [StrategyStatus.DRAFT, StrategyStatus.PAUSED, StrategyStatus.RETIRED, StrategyStatus.ARCHIVED];

function Chip({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}>
    <Text style={[styles.hint, selected && { color: colors.cyan }]}>{selected ? '✓ ' : ''}{label}</Text>
  </Pressable>;
}

function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && { color: colors.textPrimary }]}>{label}</Text>
  </Pressable>;
}

/** Schedules unattended Testing sessions that rotate through authorized strategies. */
export function AutopilotPanel({ today }: { today: DailyBotToday }) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rotation, setRotation] = useState<AutopilotRotation>('PARALLEL');
  const [startTime, setStartTime] = useState('09:20');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await apiClient.getAutopilot()); } catch (failure) { setError(formatErrorMessage(failure)); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const authorized = today.strategies.filter((strategy) => !UNAUTHORIZED.includes(strategy.status));
  // Rules come from the latest saved Daily Bot setup, so limits are reviewed in the existing wizard.
  const source = today.todaySetup ?? today.previousSetup ?? today.setups[0] ?? null;
  const template: AutopilotTemplate | null = source ? (({ name: _n, tradingDate: _d, strategyId: _s, tradingMode: _m, ...rest }) => rest)(source.config) : null;
  const schedule = status?.schedule;
  const activeTemplate = schedule?.template ?? template;
  const strategyName = (id: string | null | undefined) => today.strategies.find((strategy) => strategy.id === id)?.name ?? 'Unavailable strategy';

  const openEditor = () => {
    setSelected(schedule?.strategyIds.filter((id) => authorized.some((strategy) => strategy.id === id)) ?? authorized.slice(0, 3).map((strategy) => strategy.id));
    setRotation(schedule?.rotation ?? 'PARALLEL');
    setStartTime(schedule?.autoStartTime ?? '09:20');
    setConsent(false); setError(null); setEditing(true);
  };

  const run = async (operation: () => Promise<AutopilotStatus>) => {
    setBusy(true); setError(null);
    try { setStatus(await operation()); setEditing(false); } catch (failure) { setError(formatErrorMessage(failure)); } finally { setBusy(false); }
  };
  const enable = () => template && run(() => apiClient.updateAutopilot({ enabled: true, operatorConsent: consent, strategyIds: selected, rotation, autoStartTime: startTime, template }));

  return <View style={styles.card}>
    <View style={styles.rowBetween}>
      <View style={{ flexShrink: 1, gap: 4 }}>
        <Text style={styles.eyebrow}>AUTOPILOT · TESTING ONLY</Text>
        <Text style={styles.heading}>Scheduled Daily Bot</Text>
        <Text style={styles.description}>Starts Testing on every trading day without you. Run all chosen strategies side by side, each with its own virtual account, or one strategy per day. Live sessions still start manually with per-entry approval.</Text>
      </View>
      <Text style={styles.status}>{schedule?.enabled ? 'ENABLED' : 'OFF'}</Text>
    </View>
    {error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}

    {schedule?.enabled && !editing && <>
      <Text style={styles.description}>Starts at {schedule.autoStartTime} IST · {schedule.rotation === 'PARALLEL' ? `All ${schedule.strategyIds.length} strategies in parallel, each with its own virtual account` : `${schedule.rotation === 'ROUND_ROBIN' ? 'One strategy per day, in rotation' : 'First authorized strategy every day'} · Next: ${strategyName(status?.nextStrategyId)}`}</Text>
      {status?.today && <View style={styles.innerCard}>
        <Text style={styles.label}>Today: {status.today.status}{status.today.strategyName ? ` · ${status.today.strategyName}` : ''}</Text>
        <Text style={styles.hint}>{status.today.message}</Text>
      </View>}
    </>}

    {editing && <View style={{ gap: 12 }}>
      <Text style={styles.label}>Strategies ({selected.length} selected)</Text>
      {authorized.length === 0 && <Text style={styles.errorText}>No strategy is authorized yet. Backtest a strategy and promote it to Paper Active in Strategies.</Text>}
      <View style={styles.row}>{authorized.map((strategy) => <Chip key={strategy.id} label={`${strategy.name} · ${strategy.underlying}`} selected={selected.includes(strategy.id)}
        onPress={() => setSelected((current) => current.includes(strategy.id) ? current.filter((id) => id !== strategy.id) : [...current, strategy.id])} />)}</View>
      <View style={styles.row}>
        <Chip label="All in parallel (recommended)" selected={rotation === 'PARALLEL'} onPress={() => setRotation('PARALLEL')} />
        <Chip label="One per day, rotating" selected={rotation === 'ROUND_ROBIN'} onPress={() => setRotation('ROUND_ROBIN')} />
        <Chip label="Same strategy every day" selected={rotation === 'FIXED'} onPress={() => setRotation('FIXED')} />
      </View>
      {rotation === 'PARALLEL' && <Text style={styles.hint}>Each strategy gets its own virtual ₹{(activeTemplate?.dailyCapitalBudget ?? 10000).toLocaleString('en-IN')} account and limits, as if it traded alone. Combined virtual exposure is the sum of all lanes.</Text>}
      <Text style={styles.label}>Auto-start time (IST, HH:mm)</Text>
      <TextInput accessibilityLabel="Auto-start time" value={startTime} onChangeText={setStartTime} style={styles.input} autoCapitalize="none" />
      {!template && <Text style={styles.errorText}>Save one Daily Bot setup first. Autopilot reuses its capital, loss and timing limits.</Text>}
    </View>}

    {activeTemplate && <Text style={styles.hint}>
      Daily rules{editing && source ? ` from setup “${source.config.name}”` : ''}: capital {money(activeTemplate.dailyCapitalBudget)} · max daily loss {money(activeTemplate.dailyMaxLossAllIn)} · risk per trade {money(activeTemplate.perTradeMaxLossAllIn)} · up to {activeTemplate.maximumTradesPerDay} trades · entries {activeTemplate.entryStartTime}–{activeTemplate.lastEntryTime} · exit by {activeTemplate.mandatoryExitTime} IST.
    </Text>}

    {!!status?.lanes.length && !editing && <View style={{ gap: 8 }}>
      <Text style={styles.label}>Parallel Testing Lanes</Text>
      {status.lanes.map((lane) => <View key={lane.strategyId} style={styles.innerCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>{lane.strategyName}</Text>
          <Text style={styles.status}>{lane.status ?? 'IDLE'}</Text>
        </View>
        <Text style={styles.hint}>Realized {money(lane.realizedNetPnl)} · {lane.tradesExecuted} trades · virtual funds {money(lane.availableFunds)}{lane.openPositions.length ? ` · open: ${lane.openPositions.join(', ')}` : ''}</Text>
        {lane.lastMessage && <Text style={styles.hint}>{lane.lastMessage}</Text>}
      </View>)}
      <View style={styles.row}>
        <Button label="Stop New Entries in All Lanes" secondary disabled={busy} onPress={() => { void run(() => apiClient.stopAutopilotLanes(false)); }} />
        <Button label="Emergency Exit All Lanes" secondary disabled={busy} onPress={() => { void run(() => apiClient.stopAutopilotLanes(true)); }} />
      </View>
    </View>}

    {editing && <Chip label="I authorize unattended Testing sessions with these limits on every trading day until I turn Autopilot off." selected={consent} onPress={() => setConsent(!consent)} />}

    <View style={styles.row}>
      {!editing && <Button label={schedule?.enabled ? 'Change Schedule' : 'Set Up Autopilot'} disabled={busy} secondary={schedule?.enabled} onPress={openEditor} />}
      {editing && <Button label="Enable Autopilot" disabled={busy || !consent || !template || selected.length === 0} onPress={() => { void enable(); }} />}
      {editing && <Button label="Cancel" secondary disabled={busy} onPress={() => setEditing(false)} />}
      {schedule?.enabled && !editing && <Button label="Turn Off Autopilot" secondary disabled={busy} onPress={() => { void run(() => apiClient.disableAutopilot()); }} />}
    </View>
    <Text style={styles.hint}>The server must stay running, and Upstox must be connected each morning for live market data. Turning Autopilot off does not stop a session already running.</Text>

    {!!status?.scorecard.length && <View style={{ gap: 8 }}>
      <Text style={styles.label}>Strategy Scorecard</Text>
      {status.scorecard.map((row) => <View key={`${row.strategyId}-${row.tradingMode}`} style={styles.innerCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>{row.strategyName} · {row.tradingMode === 'PAPER' ? 'Testing' : 'Live'}</Text>
          <Text style={[styles.label, { color: row.netPnl >= 0 ? colors.profit : colors.loss }]}>{money(row.netPnl)}</Text>
        </View>
        <Text style={styles.hint}>{row.tradingDays} days · {row.closedTrades} trades · win rate {row.winRatePct ?? '–'}% · avg win {row.averageWin === null ? '–' : money(row.averageWin)} · avg loss {row.averageLoss === null ? '–' : money(row.averageLoss)} · worst day {money(row.worstDayPnl)} · profit factor {row.profitFactor ?? '–'}</Text>
      </View>)}
      <Text style={styles.hint}>Testing results use simulated fills and modeled charges. A few days of results are not evidence of future profit.</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 22, gap: 18 },
  innerCard: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  status: { color: colors.cyan, backgroundColor: colors.surfaceSubtle, borderRadius: 4, padding: 8, fontSize: 12, fontWeight: '700' },
  button: { borderRadius: 7, backgroundColor: colors.cyan, borderWidth: 1, borderColor: colors.cyan, paddingVertical: 12, paddingHorizontal: 18, alignSelf: 'flex-start' },
  secondaryButton: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderHover },
  buttonText: { color: '#05151B', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  errorText: { color: colors.loss, fontSize: 14, lineHeight: 22 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12, flexShrink: 1 },
  chipSelected: { borderColor: colors.cyan, backgroundColor: 'rgba(6,182,212,0.12)' },
  input: { color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, maxWidth: 140 },
});
