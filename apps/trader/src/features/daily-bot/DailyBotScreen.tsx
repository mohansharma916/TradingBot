import { useState } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { DailyBotConfig, DailyBotSession, DailyBotSetup, TradeMode } from '@trading-bot/contracts';
import { colors, spacing } from '@trading-bot/ui';
import { useDailyBot } from '../../hooks/useDailyBot';
import { configToDraft, createDailyBotDraft, DailyBotDraft, validateDailyBotDraft } from './config';

const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const stepNames = ['Capital', 'Risk Limits', 'Profit Protection', 'Trading Window', 'Strategy', 'Review & Start'];

function Button({ label, onPress, disabled = false, secondary = false, danger = false }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={onPress} style={[styles.button, secondary && styles.secondaryButton,
      danger && styles.dangerButton, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && { color: colors.textPrimary }]}>{label}</Text>
  </Pressable>;
}

function Field({ label, value, onChange, hint, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void; hint?: string; numeric?: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
      keyboardType={numeric ? 'decimal-pad' : 'default'} autoCapitalize="none"
      style={styles.input} placeholderTextColor={colors.textMuted} />
    {hint && <Text style={styles.hint}>{hint}</Text>}
  </View>;
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <View style={styles.metric}>
    <Text style={styles.hint}>{label}</Text>
    <Text style={[styles.metricValue, positive && { color: colors.profit }]}>{value}</Text>
  </View>;
}

function SetupSummary({ setup }: { setup: DailyBotSetup }) {
  return <View style={styles.row}>
    <Metric label="Daily capital" value={money(setup.config.dailyCapitalBudget)} />
    <Metric label="Maximum daily loss" value={money(setup.config.dailyMaxLossAllIn)} />
    <Metric label="Risk per trade, including costs" value={money(setup.config.perTradeMaxLossAllIn)} />
    <Metric label="Start trailing at net profit" value={money(setup.config.minNetProfitToActivateTrailing)} />
  </View>;
}

function SessionMonitor({ session, busy, control }: {
  session: DailyBotSession; busy: boolean;
  control: ReturnType<typeof useDailyBot>['control'];
}) {
  const openTrades = session.trades.filter((trade) => trade.status !== 'CLOSED');
  const realized = session.trades.reduce((total, trade) => total + trade.realizedNetPnl, 0);
  const unrealized = openTrades.reduce((total, trade) => total + (trade.netPnl ?? 0), 0);
  const allocated = openTrades.reduce((total, trade) => total + trade.entryPrice * trade.quantity, 0);
  return <View style={styles.card}>
    <View style={styles.rowBetween}>
      <View><Text style={styles.heading}>Today's Trading Session</Text>
        <Text style={styles.description}>{session.strategySnapshot.name} · Version {session.strategySnapshot.version}</Text></View>
      <Text style={styles.status}>{session.status.replace(/_/g, ' ')}</Text>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.description}>{session.lastMessage}</Text>
    <View style={styles.row}>
      <Metric label="Realized net P&L" value={money(realized)} positive={realized >= 0} />
      <Metric label="Estimated open net P&L" value={money(unrealized)} positive={unrealized >= 0} />
      <Metric label="Allocated capital" value={money(allocated)} />
      <Metric label="Entry trades today" value={`${session.tradesExecuted} / ${session.config.maximumTradesPerDay}`} />
    </View>
    <View style={styles.row}>
      {session.status === 'RUNNING' && <Button label="Pause New Entries" disabled={busy}
        secondary onPress={() => { void control(session.id, 'pause'); }} />}
      {session.status === 'PAUSED' && <Button label="Resume Bot" disabled={busy}
        onPress={() => { void control(session.id, 'resume'); }} />}
      {['RUNNING', 'PAUSED', 'ERROR'].includes(session.status) && <Button label="Stop New Entries" disabled={busy}
        secondary onPress={() => { void control(session.id, 'stop'); }} />}
      {session.pendingProposalId && session.status === 'RUNNING' && <Button label="Approve Entry" disabled={busy}
        onPress={() => { void control(session.id, 'approve-entry'); }} />}
      {(openTrades.length > 0 || ['RUNNING', 'PAUSED', 'STOPPING'].includes(session.status)) &&
        <Button label="Emergency Stop & Request Exit" disabled={busy} danger
          onPress={() => { void control(session.id, 'emergency-stop'); }} />}
    </View>
    <Text style={styles.hint}>Pausing or stopping entries keeps position protection active. Exit requests are confirmed against fills.</Text>
    {openTrades.length === 0 && <Text style={styles.description}>No open bot positions. The backend waits for a valid strategy signal.</Text>}
    {openTrades.map((trade) => <View key={trade.orderId} style={styles.innerCard}>
      <View style={styles.rowBetween}><Text style={styles.heading}>{trade.symbol}</Text><Text style={styles.status}>{trade.status}</Text></View>
      <Text style={styles.description}>{trade.quantity} units · Entry {money(trade.entryPrice)} · Current bid {money(trade.currentPrice)}</Text>
      <View style={styles.row}>
        <Metric label="Protective stop" value={money(trade.stopPrice)} />
        <Metric label="Peak net profit" value={money(trade.peakNetProfit)} />
        <Metric label="Profit protection target" value={money(trade.protectedNetProfit)} />
        <Metric label="Trailing" value={trade.trailingActive ? 'ACTIVE' : 'Waiting for threshold'} />
      </View>
      <Text style={styles.hint}>Order {trade.orderId} · Paper protection is managed by the backend. Profit protection is a target.</Text>
    </View>)}
    <Text style={styles.label}>Recent Bot Events</Text>
    {session.events.slice(-8).reverse().map((event, index) => <View key={`${event.timestamp}-${index}`} style={styles.event}>
      <Text style={styles.hint}>{new Date(event.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {event.type}</Text>
      <Text style={styles.description}>{event.message}</Text>
    </View>)}
    <Text style={styles.hint}>Last heartbeat: {session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Waiting'} · Bot runs on the backend when you leave this screen.</Text>
  </View>;
}

export default function DailyBotScreen() {
  const bot = useDailyBot();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<'today' | 'history' | 'report'>('today');
  const [draft, setDraft] = useState<DailyBotDraft | null>(null);
  const [step, setStep] = useState(0);
  const [savedSetup, setSavedSetup] = useState<DailyBotSetup | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const today = bot.today;
  const session = today?.activeSession ?? today?.session;
  const update = (field: keyof DailyBotConfig, value: string) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setSavedSetup(null); setConsent(false); setValidationError(null); bot.clearPreflight();
  };
  const begin = (setup?: DailyBotSetup) => {
    if (!today) return;
    setDraft(setup ? configToDraft({ ...setup.config, tradingDate: today.tradingDate }) :
      createDailyBotDraft(today.tradingDate, today.strategies[0]));
    setSavedSetup(setup?.config.tradingDate === today.tradingDate ? setup : null);
    setStep(0); setConsent(false); setValidationError(null); bot.clearPreflight(); setTab('today');
  };
  const reuse = async (setup: DailyBotSetup) => {
    if (!today) return;
    const cloned = await bot.clone(setup.id, today.tradingDate);
    if (cloned) { begin(cloned); setStep(5); }
  };
  const saveAndCheck = async () => {
    if (!draft) return;
    const parsed = validateDailyBotDraft(draft);
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((issue) => issue.message).join('\n'));
      return;
    }
    const setup = savedSetup ?? await bot.save(parsed.data);
    if (setup) { setSavedSetup(setup); await bot.check(setup.id); }
  };
  const start = async () => {
    if (!savedSetup || !consent || !bot.preflight?.passed) return;
    const result = await bot.start(savedSetup.id, consent);
    if (result) { setDraft(null); setSavedSetup(null); setConsent(false); }
  };
  const field = (key: keyof DailyBotConfig, label: string, hint?: string, numeric = true) =>
    <Field key={key} label={label} hint={hint} value={draft?.[key] ?? ''}
      numeric={numeric} onChange={(value) => update(key, value)} />;

  return <View style={[styles.page, width < 650 && { padding: spacing.sm }]}>
    <View style={styles.rowBetween}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MAIN FEATURE · DAILY SETUP & EXECUTION</Text>
        <Text accessibilityRole="header" style={styles.title}>Daily Trading Bot</Text>
        <Text style={styles.description}>Plan today's risk, choose your strategy, and manage one protected trading session.</Text>
      </View>
      <Button label="Refresh" secondary disabled={bot.busy} onPress={() => { void bot.refresh(); }} />
    </View>
    {bot.loading && <View style={styles.row}><ActivityIndicator color={colors.cyan} /><Text style={styles.description}>Connecting to your trading account…</Text></View>}
    {bot.error && <View accessibilityRole="alert" style={styles.error}>
      <Text style={styles.errorText}>{bot.error}</Text>
      <Text style={styles.hint}>Check the API connection and retry. Orders and session changes require backend confirmation.</Text>
    </View>}
    {today && <>
      <View style={styles.row}>
        <Metric label="Trading date · IST" value={today.tradingDate} />
        <Metric label="Available paper funds" value={money(today.availableFunds)} />
        <Metric label="Execution" value={session?.config.tradingMode ?? 'PAPER'} />
        <Metric label="Today's bot" value={session?.status ?? (today.todaySetup ? 'SETUP SAVED' : 'NOT STARTED')} />
      </View>
      <View style={styles.tabs}>
        {([{ key: 'today', label: "Today's Bot" }, { key: 'history', label: 'Setup History' }, { key: 'report', label: 'Session Report' }] as const)
          .map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}
            onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.selectedTab]}>
            <Text style={[styles.label, tab === item.key && { color: colors.cyan }]}>{item.label}</Text>
          </Pressable>)}
      </View>
      {tab === 'today' && <>
        {session && !draft && <SessionMonitor session={session} busy={bot.busy} control={bot.control} />}
        {!draft && !today.activeSession && <View style={styles.card}>
          <Text style={styles.heading}>{today.setups.length === 0 ? 'Create Your First Trading Bot' : 'Prepare Your Trading Day'}</Text>
          <Text style={styles.description}>{today.setups.length === 0 ?
            'Start with paper trading. Set a capital budget, define losses you can accept, and select a strategy before execution.' :
            'Reuse a saved setup or create a new one. Today’s funds, strategy and market conditions are checked before every start.'}</Text>
          {today.todaySetup && <><Text style={styles.label}>Today's saved setup: {today.todaySetup.config.name}</Text><SetupSummary setup={today.todaySetup} /></>}
          <View style={styles.row}>
            <Button label={today.setups.length === 0 ? 'Create Your First Trading Bot' : 'Create New Setup'}
              disabled={bot.busy || today.strategies.length === 0} onPress={() => begin()} />
            {today.todaySetup && <Button label="Review Today's Setup" disabled={bot.busy} secondary onPress={() => { begin(today.todaySetup!); setStep(5); }} />}
            {today.previousSetup && <Button label="Reuse Previous Trading Day Setup" disabled={bot.busy} secondary
              onPress={() => { void reuse(today.previousSetup!); }} />}
            {today.setups.length > 0 && <Button label="Choose Older Setup" secondary disabled={bot.busy} onPress={() => setTab('history')} />}
          </View>
          {today.strategies.length === 0 && <Text style={styles.errorText}>Create a strategy in Strategies before creating a daily setup.</Text>}
        </View>}
        {draft && <View style={styles.card}>
          <View style={styles.rowBetween}><Text style={styles.heading}>Daily Setup · {draft.tradingDate}</Text>
            <Button label="Close Setup" secondary disabled={bot.busy} onPress={() => setDraft(null)} /></View>
          <View style={styles.steps}>{stepNames.map((name, index) => <Pressable key={name}
            accessibilityRole="button" accessibilityLabel={`Step ${index + 1}: ${name}`} disabled={bot.busy}
            onPress={() => setStep(index)} style={[styles.step, step === index && styles.selectedTab]}>
            <Text style={[styles.hint, step === index && { color: colors.cyan }]}>{index + 1}. {name}</Text>
          </Pressable>)}</View>
          <Text style={styles.heading}>{stepNames[step]}</Text>
          {step === 0 && <>
            {field('name', 'Setup Name', 'A name to help you reuse this configuration.', false)}
            {field('dailyCapitalBudget', 'Total Trading Fund for Today (₹)', 'Capital allocation, separate from permitted loss. Maximum account capital: ₹10,000.')}
            {field('maxCapitalPerTrade', 'Maximum Capital Per Trade (₹)')}
            <Text style={styles.label}>Execution Mode</Text>
            <View style={styles.row}>{[{ mode: TradeMode.PAPER, label: 'Paper Trading' }, { mode: TradeMode.APPROVAL, label: 'Manual Approval' },
              { mode: TradeMode.AUTO, label: 'Fully Automated' }].map(({ mode, label }) =>
              <Button key={mode} label={label} secondary={draft.tradingMode !== mode}
                disabled={!today.supportedModes.includes(mode)} onPress={() => update('tradingMode', mode)} />)}</View>
            <Text style={styles.hint}>Paper mode executes strategy signals with simulated funds. Live modes require validated broker protection and account authorization.</Text>
          </>}
          {step === 1 && <View style={styles.fields}>
            {field('dailyMaxLossAllIn', 'Maximum Daily Loss (₹)', 'Includes trading costs and outstanding risk. Account cap: ₹1,500.')}
            {field('perTradeMaxLossAllIn', 'Maximum Risk Per Trade (₹)', 'Stop-loss risk plus charges and slippage. Account cap: ₹500.')}
            {field('maximumTradesPerDay', 'Maximum Trades Per Day')}
            {field('maxRoundTripCharges', 'Maximum Estimated Round-trip Charges (₹)')}
            <Text style={styles.description}>Maximum concurrent positions: 1. All strategies share the same account risk limits.</Text>
            <Text style={styles.hint}>The selected strategy may set lower risk limits. The strictest strategy, daily setup and account limits apply to every trade.</Text>
          </View>}
          {step === 2 && <>
            {field('minNetProfitToActivateTrailing', 'Net Profit to Activate Trailing (₹)', 'An activation threshold; realized profit depends on the actual exit fill.')}
            {field('desiredNetProfitLock', 'Initial Net Profit Protection Target (₹)', 'Must be below the trailing activation amount.')}
            <View style={styles.row}><Button label="Step-based Profit Lock" secondary={draft.trailingAlgorithm !== 'STEP_LOCK'}
              onPress={() => update('trailingAlgorithm', 'STEP_LOCK')} />
              <Button label="Percentage Trailing" secondary={draft.trailingAlgorithm !== 'FIXED_PERCENT'} onPress={() => update('trailingAlgorithm', 'FIXED_PERCENT')} /></View>
            {draft.trailingAlgorithm === 'STEP_LOCK' ? <>
              {field('trailingStepProfit', 'Additional Peak Net Profit per Step (₹)')}
              {field('trailingStepLock', 'Increase Protection Target per Step (₹)')}
            </> : field('trailingPercent', 'Trailing Distance Below Peak (%)')}
            {field('dailyNetProfitObjective', 'Daily Profit Objective (₹, optional)', 'For reporting only. The bot never forces trades to reach this amount.')}
            <Text style={styles.hint}>Every entry starts with an initial stop. Trailing improves protection only after the threshold is reached.</Text>
          </>}
          {step === 3 && <View style={styles.fields}>
            {field('entryStartTime', 'Entry Start (HH:mm IST)', undefined, false)}
            {field('lastEntryTime', 'Last Entry (HH:mm IST)', undefined, false)}
            {field('mandatoryExitTime', 'Mandatory Exit (HH:mm IST)', 'The backend manages exits even when you close the app.', false)}
            <Text style={styles.description}>Trade only during market hours. Contract expiry, tick size, whole lots, funds, spread and quote freshness are checked by the backend.</Text>
          </View>}
          {step === 4 && <>
            <Text style={styles.description}>Select one versioned strategy for this session. Its rules are saved as an immutable snapshot.</Text>
            {today.strategies.map((strategy) => <Pressable key={strategy.id} accessibilityRole="radio"
              accessibilityState={{ checked: draft.strategyId === strategy.id }} onPress={() => update('strategyId', strategy.id)}
              style={[styles.innerCard, draft.strategyId === strategy.id && { borderColor: colors.cyan }]}>
              <View style={styles.rowBetween}><Text style={styles.heading}>{strategy.name}</Text><Text style={styles.status}>{strategy.status}</Text></View>
              <Text style={styles.description}>{strategy.underlying} · {strategy.timeframe} candles · Version {strategy.version} · {strategy.allowedInstruments.join(', ')}</Text>
              <Text style={styles.hint}>EMA {strategy.entry.emaPeriod} · RSI {strategy.entry.rsiPeriod} ≥ {strategy.entry.rsiThreshold} · Spread ≤ {strategy.entry.maxBidAskSpreadPct}%</Text>
            </Pressable>)}
            <Button label="Manage Custom Strategies" secondary onPress={() => router.push('/strategies')} />
          </>}
          {step === 5 && <>
            <Text style={styles.description}>Review your configuration, save today's snapshot, then check account and market readiness.</Text>
            <View style={styles.row}>
              <Metric label="Capital" value={money(Number(draft.dailyCapitalBudget))} />
              <Metric label="Daily loss cap" value={money(Number(draft.dailyMaxLossAllIn))} />
              <Metric label="Risk per trade" value={money(Number(draft.perTradeMaxLossAllIn))} />
              <Metric label="Trailing activation" value={money(Number(draft.minNetProfitToActivateTrailing))} />
            </View>
            <Text style={styles.description}>{today.strategies.find((strategy) => strategy.id === draft.strategyId)?.name ?? savedSetup?.strategySnapshot.name ?? 'Select a strategy'} · {draft.tradingMode}</Text>
            <Text style={styles.description}>{draft.entryStartTime}–{draft.lastEntryTime} entry window · Exit {draft.mandatoryExitTime} IST · {draft.maximumTradesPerDay} trades maximum</Text>
            <Button label={bot.busy ? 'Checking…' : savedSetup ? 'Check Readiness Again' : 'Save Setup & Check Readiness'} disabled={bot.busy}
              onPress={() => { void saveAndCheck(); }} />
            {savedSetup && <Text style={styles.hint}>Setup saved. You can return to it later, including while the market is closed.</Text>}
            {bot.preflight && <View style={styles.innerCard}>
              <Text style={styles.heading}>{bot.preflight.passed ? 'Ready to Start' : 'Start Blocked — Resolve These Checks'}</Text>
              {bot.preflight.checks.map((check) => <View key={check.id} style={styles.event}>
                <Text style={[styles.label, { color: check.passed ? colors.profit : colors.warning }]}>{check.passed ? '✓' : '!'} {check.label}</Text>
                <Text style={styles.description}>{check.message}</Text>
              </View>)}
            </View>}
            <Pressable accessibilityRole="checkbox" accessibilityLabel="Authorize this trading session" accessibilityState={{ checked: consent }}
              disabled={bot.busy || !bot.preflight?.passed} onPress={() => setConsent((value) => !value)} style={styles.row}>
              <Text style={styles.status}>{consent ? '☑' : '☐'}</Text>
              <Text style={styles.description}>I authorize this {draft.tradingMode === TradeMode.PAPER ? 'paper' : 'live'} session using the reviewed capital, risk and strategy settings.</Text>
            </Pressable>
            <Button label={bot.busy ? 'Please wait…' : 'Start Trading Bot'} disabled={bot.busy || !consent || !savedSetup || !bot.preflight?.passed}
              onPress={() => { void start(); }} />
          </>}
          {validationError && <Text accessibilityRole="alert" style={styles.errorText}>{validationError}</Text>}
          <View style={styles.rowBetween}>
            {step > 0 ? <Button label="Previous Step" secondary disabled={bot.busy} onPress={() => setStep((value) => value - 1)} /> : <View />}
            {step < stepNames.length - 1 && <Button label="Next Step" disabled={bot.busy} onPress={() => setStep((value) => value + 1)} />}
          </View>
        </View>}
      </>}
      {tab === 'history' && <View style={styles.card}>
        <Text style={styles.heading}>Saved Daily Setups</Text>
        <Text style={styles.description}>Reuse creates a new dated setup. Earlier settings and strategy versions stay unchanged.</Text>
        {today.setups.length === 0 && <Text style={styles.description}>Your saved setups will appear here after you complete the wizard.</Text>}
        {today.setups.map((setup) => <View key={setup.id} style={styles.innerCard}>
          <View style={styles.rowBetween}><Text style={styles.heading}>{setup.config.name}</Text><Text style={styles.status}>{setup.config.tradingDate}</Text></View>
          <Text style={styles.description}>{setup.strategySnapshot.name} · Version {setup.strategySnapshot.version} · {setup.config.tradingMode}</Text>
          <SetupSummary setup={setup} />
          <View style={styles.row}><Button label="Reuse Setup for Today" secondary disabled={bot.busy || !!today.activeSession}
            onPress={() => { void reuse(setup); }} />
            <Button label="Copy & Modify Setup" secondary disabled={bot.busy || !!today.activeSession} onPress={() => begin(setup)} /></View>
        </View>)}
      </View>}
      {tab === 'report' && <View style={styles.card}>
        <Text style={styles.heading}>Daily Session Report</Text>
        {!session ? <Text style={styles.description}>Start a session to record trades, costs and risk decisions.</Text> : <>
          <Text style={styles.description}>{session.config.tradingDate} · {session.strategySnapshot.name} · {session.status}</Text>
          <View style={styles.row}>
            <Metric label="Trades" value={String(session.tradesExecuted)} />
            <Metric label="Realized net P&L" value={money(session.trades.reduce((sum, trade) => sum + trade.realizedNetPnl, 0))} />
            <Metric label="Estimated trade costs" value={money(session.trades.reduce((sum, trade) => sum + trade.estimatedCharges, 0))} />
          </View>
          {session.trades.length === 0 && <Text style={styles.description}>No trades executed. The event log shows skipped signals and readiness checks.</Text>}
          {session.trades.map((trade) => <View key={trade.orderId} style={styles.innerCard}>
            <Text style={styles.label}>{trade.symbol} · {trade.status}</Text>
            <Text style={styles.description}>{trade.quantity} units · Entry {money(trade.entryPrice)} · Net realized {money(trade.realizedNetPnl)}</Text>
          </View>)}
          {session.events.slice().reverse().map((event, index) => <View key={`${event.timestamp}-${index}`} style={styles.event}>
            <Text style={styles.hint}>{new Date(event.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {event.type}</Text>
            <Text style={styles.description}>{event.message}</Text>
          </View>)}
        </>}
      </View>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 20 },
  header: { flex: 1, minWidth: 220, gap: 7 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: colors.textPrimary, fontSize: 30, fontWeight: '700' },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 22, gap: 18 },
  innerCard: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  metric: { flex: 1, minWidth: 170, backgroundColor: colors.surfaceSubtle, borderRadius: 8, padding: 16, gap: 8 },
  metricValue: { color: colors.textPrimary, fontSize: 21, fontWeight: '600' },
  status: { color: colors.cyan, backgroundColor: colors.surfaceSubtle, borderRadius: 4, padding: 8, fontSize: 12, fontWeight: '700' },
  button: { borderRadius: 7, backgroundColor: colors.cyan, borderWidth: 1, borderColor: colors.cyan, paddingVertical: 12, paddingHorizontal: 18, alignSelf: 'flex-start' },
  secondaryButton: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderHover },
  dangerButton: { backgroundColor: colors.loss, borderColor: colors.loss },
  buttonText: { color: '#05151B', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  field: { gap: 7, maxWidth: 600, width: '100%' },
  fields: { gap: 18 },
  input: { color: colors.textPrimary, backgroundColor: colors.background, borderColor: colors.borderHover, borderWidth: 1, borderRadius: 7, minHeight: 45, padding: 12, fontSize: 16 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
  tab: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 6 },
  selectedTab: { backgroundColor: 'rgba(6,182,212,0.12)' },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { padding: 10, borderRadius: 5 },
  error: { backgroundColor: colors.lossMuted, borderWidth: 1, borderColor: colors.lossBorder, padding: 16, borderRadius: 8, gap: 8 },
  errorText: { color: colors.loss, fontSize: 14, lineHeight: 22 },
  event: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 4 },
});
