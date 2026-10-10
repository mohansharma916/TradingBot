import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  AgentToolName, AllowedOptionType, DailyBotConfig, DailyBotConfigSchema, DailyBotPreflight,
  DailyBotSession, DailyBotTrade, InstrumentType, OrderSide, OrderType,
  ProductType, ProposalStatus, QuoteSnapshot, StrategyConfig, StrategyStatus, TradeMode, TradeProposal,
} from '@trading-bot/contracts';
import { calculateOptionCharges, evaluateStrategySignal, isCalendarVerifiedForDate, NSE_HOLIDAYS_2026, strategyExitLevels, strategyTimeframeMinutes } from '@trading-bot/domain';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { AgentToolsService } from '../agents/agent-tools.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { EnvService } from '../config/env.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { EventsGateway } from '../websocket/events.gateway';
import { BrokerRouterService } from '../broker/broker-router.service';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';
import { TradingModeService } from '../trading/trading-mode.service';
import { OrdersService, OwnedExitResult } from '../orders/orders.service';
import { GoLiveChecklistService } from '../orders/go-live-checklist.service';
import { BrokerRequestError } from '../broker/upstox-broker.adapter';

type SessionCheckpoint = (session: DailyBotSession) => void | Promise<void>;
class DailyEntryDispatchRefusal extends BadRequestException {}

/** Executes the immutable daily strategy snapshot and owns protection independently of the UI. */
@Injectable()
export class DailyBotExecutionService {
  private readonly working = new Set<string>();

  constructor(
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(RiskReservationManager) private readonly reservations: RiskReservationManager,
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
    @Inject(AgentToolsService) private readonly tools: AgentToolsService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(ProposalsService) private readonly proposals: ProposalsService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
    @Optional() @Inject(TradingModeService) private readonly mode?: TradingModeService,
    @Optional() @Inject(LiveExecutionLedgerService) private readonly liveLedger?: LiveExecutionLedgerService,
    @Optional() @Inject(OrdersService) private readonly orders?: OrdersService,
    @Optional() @Inject(GoLiveChecklistService) private readonly goLiveChecklist?: GoLiveChecklistService,
  ) {}

  private get broker() { return this.router ?? this.paperBroker; }
  private isLive(): boolean { return this.router?.isLive() ?? false; }
  private matchesMode(config: DailyBotConfig): boolean {
    return config.tradingMode === (this.mode?.getMode() ?? TradeMode.PAPER) &&
      (config.tradingMode === TradeMode.PAPER || (config.tradingMode === TradeMode.APPROVAL && this.isLive()));
  }

  public restoreDailyLedger(sessions: DailyBotSession[]): Set<string> {
    const today = this.istClock().date;
    // Persistent broker/risk ledgers are authoritative. Never deduct a restored position twice.
    if (!this.isLive() && this.reservations.getActiveReservations().length === 0 && this.reservations.getRealizedDailyLoss() === 0 && this.reservations.getRealizedNetDailyPnl() === 0) {
      this.reservations.restoreDailyResults(today, sessions.filter((session) => session.config.tradingMode === TradeMode.PAPER && session.config.tradingDate === today).flatMap((session) => session.trades.filter((trade) => trade.status === 'CLOSED').map((trade) => ({ orderId: trade.orderId, realizedNetPnl: trade.realizedNetPnl }))));
    }
    const recovered = new Set<string>();
    const exposure = sessions.filter((session) => this.matchesMode(session.config)).flatMap((session) => session.trades.filter((trade) => trade.status !== 'CLOSED').map((trade) => ({ session, trade })));
    if (exposure.length === 0) return recovered;
    if (exposure.length !== 1) { this.reservations.setKillSwitch(true); return recovered; }
    const { session, trade } = exposure[0]!;
    const instrument = this.catalog.getInstrument(trade.instrumentKey) ?? trade.instrumentSnapshot;
    if (this.isLive()) {
      const entry = this.liveLedger?.getEntries().find((record) => record.proposalId === trade.proposalId && record.side === OrderSide.BUY);
      if (trade.status === 'OPEN' && entry && entry.filledQuantity === entry.quantity && entry.filledQuantity === trade.quantity && entry.reservationId === trade.reservationId && entry.gttOrderId && this.reservations.getReservation(trade.reservationId!)?.status === 'COMMITTED') recovered.add(session.id);
      this.reservations.setKillSwitch(true); // Actual broker reconciliation is required after restart.
      return recovered;
    }
    const confirmed = session.config.tradingMode === TradeMode.PAPER && session.pendingProposalId === null && trade.status === 'OPEN' &&
      trade.orderId.startsWith('ord_paper_') && trade.reservationId && trade.signalKey && trade.openedAt && Number.isFinite(Date.parse(trade.openedAt)) &&
      trade.initialStopPrice && trade.tickSize && trade.entryActualCharges !== undefined && instrument && trade.quantity % instrument.lotSize === 0 &&
      session.events.some((event) => event.type === 'ENTRY_FILLED') && session.events[session.events.length - 1]?.type !== 'EXIT_SUBMITTING';
    if (!confirmed) { this.reservations.setKillSwitch(true); return recovered; }
    try {
      const risk = this.money((trade.entryPrice - trade.initialStopPrice! + 0.25) * trade.quantity + this.roundTripCharges(trade, Math.max(1, trade.initialStopPrice! - 0.25)) + 10);
      const existing = this.reservations.getReservation(trade.reservationId!);
      if (existing && (existing.status !== 'COMMITTED' || existing.instrumentKey !== trade.instrumentKey || Math.abs(existing.reservedCapital - trade.entryPrice * trade.quantity) > 0.01)) throw new Error('Persisted position and reservation disagree.');
      if (!existing) this.reservations.restoreConfirmedPosition({ id: trade.reservationId!, proposalId: trade.proposalId, signalKey: trade.signalKey!, instrumentKey: trade.instrumentKey, reservedCapital: this.money(trade.entryPrice * trade.quantity), reservedRisk: risk, status: 'COMMITTED', createdAt: trade.openedAt! });
      this.paperBroker.restoreConfirmedPosition(trade);
      recovered.add(session.id);
    } catch { this.reservations.setKillSwitch(true); }
    return recovered;
  }

  public async preflight(config: DailyBotConfig, strategy: StrategyConfig, session?: DailyBotSession): Promise<DailyBotPreflight> {
    const checks: DailyBotPreflight['checks'] = [];
    const check = (id: string, label: string, passed: boolean, message: string) => checks.push({ id, label, passed, message });
    const clock = this.istClock();
    const parsed = DailyBotConfigSchema.safeParse(config);
    check('configuration', 'Configuration', parsed.success, parsed.success ? 'Daily limits and trading times are valid.' : parsed.error.issues.map((issue) => issue.message).join('; '));
    check('mode', 'Execution mode', this.matchesMode(config), 'The saved mode must match the global Testing/PAPER or Live/APPROVAL selection. Live entries require individual owner approval.');
    if (config.tradingMode === TradeMode.APPROVAL) {
      check('live-enabled', 'Live execution enabled', this.env.config.LIVE_EXECUTION_ENABLED && !!this.router && !!this.orders && !!this.liveLedger, 'Live execution requires the deployment flag, durable execution ledger and shared owned-exit service.');
      check('owner-readiness', 'Owner go-live verification', this.liveAuthorized(), 'Live entry requires a complete signed owner checklist with current broker, risk, recovery and protection verification evidence. Missing or unreadable evidence blocks execution.');
      try {
        const funds = await this.broker.getFunds();
        const verified = funds.source === 'LIVE_BROKER' && funds.status === 'VERIFIED' && Number.isFinite(funds.availableCash) && funds.availableCash >= 0;
        if (verified) this.reservations.synchronizeFunds(funds.availableCash);
        check('verified-funds', 'Verified broker funds', verified, verified ? `Actual broker cash ₹${funds.availableCash.toFixed(2)} was verified and synchronized.` : 'Actual live broker funds are unavailable.');
      } catch { check('verified-funds', 'Verified broker funds', false, 'Live broker funds could not be verified.'); }
    }
    check('trading-date', 'Trading date', config.tradingDate === clock.date, `Configured ${config.tradingDate}; current trading date is ${clock.date} IST.`);
    check('exchange-calendar', 'Verified exchange calendar', isCalendarVerifiedForDate(new Date(`${clock.date}T00:00:00.000Z`)), `New entries require a verified NSE F&O calendar for ${clock.date.slice(0, 4)}. The bundled calendar currently covers 2026 only.`);
    check('market-session', 'Market session', this.isTradingDay(clock) && clock.time >= '09:15' && clock.time < config.lastEntryTime, `Entries require an exchange trading day between 09:15 and ${config.lastEntryTime} IST; current time is ${clock.weekday} ${clock.time}${NSE_HOLIDAYS_2026[clock.date] ? ` (${NSE_HOLIDAYS_2026[clock.date]})` : ''}.`);
    const timeframe = strategyTimeframeMinutes(strategy.timeframe);
    const supportedExits = strategyExitLevels({ strategy, entryPrice: 10000, quantity: 1 });
    check('strategy', 'Selected strategy', strategy.id === config.strategyId && strategy.market === 'NSE_FO' && [1, 5, 15, 30].includes(timeframe) && !strategy.astConfig?.indicators?.some((indicator) => indicator.timeframe && indicator.timeframe !== strategy.timeframe) && !supportedExits.error && ![StrategyStatus.RETIRED, StrategyStatus.PAUSED, StrategyStatus.DRAFT].includes(strategy.status), supportedExits.error ?? 'Use an active intraday option strategy with aligned supported indicator timeframes and premium exits.');
    check('kill-switch', 'Account risk gate', !this.reservations.isKillSwitchActive(), this.reservations.isKillSwitchActive() ? 'The account kill switch is active. Review account risk before enabling entries.' : 'Account kill switch is clear.');
    const owned = session?.trades.filter((trade) => trade.status !== 'CLOSED') ?? [];
    const positions = (await this.broker.getPositions()).filter((position) => position.netQuantity !== 0);
    const unmanaged = positions.filter((position) => !owned.some((trade) => trade.instrumentKey === position.instrumentKey && trade.quantity === position.netQuantity));
    const unresolved = (await this.broker.getOrders()).some((order) => ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'SUBMITTING', 'UNKNOWN_BROKER_STATE'].includes(order.status));
    check('reconciliation', 'Existing exposure', unmanaged.length === 0 && !unresolved && owned.every((trade) => positions.some((position) => position.instrumentKey === trade.instrumentKey && position.netQuantity === trade.quantity)), unmanaged.length || unresolved ? 'Resolve existing unmanaged positions or unfinished orders before starting this bot.' : owned.length ? 'Existing owned position quantity reconciles.' : 'Account is flat with no unfinished paper orders.');
    const ownedCapital = owned.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
    const loss = this.sessionLoss(session);
    const remainingAllocation = Math.max(0, config.dailyCapitalBudget - loss);
    check('capital', 'Available funds', (session ? remainingAllocation : config.dailyCapitalBudget) <= this.reservations.getAvailableCash() + ownedCapital && config.dailyCapitalBudget <= this.env.config.MAX_ACCOUNT_CAPITAL_INR, `Remaining daily allocation ₹${remainingAllocation.toFixed(2)}; available account cash ₹${this.reservations.getAvailableCash().toFixed(2)}. Account hard caps also apply.`);
    check('daily-risk', 'Daily loss budget', loss < config.dailyMaxLossAllIn && this.reservations.getRemainingDailyRiskBudget() > 0, `Daily loss used ₹${loss.toFixed(2)} of ₹${config.dailyMaxLossAllIn}.`);
    const underlying = this.underlyingKey(strategy);
    await this.tools.hydrateHistory(underlying, strategy.timeframe);
    const quote = this.feed.getQuote(underlying);
    const options = this.catalog.getUnderlyingInstruments(strategy.underlying).filter((instrument) => [InstrumentType.CE, InstrumentType.PE].includes(instrument.instrumentType));
    check('market-data', 'Fresh market data', this.fresh(quote, false) && options.some((instrument) => this.fresh(this.feed.getQuote(instrument.instrumentKey))), 'Recent observed underlying prices and option depth must be available within 3 seconds. Live mode accepts LIVE provenance only.');
    const bars = this.tools.getClosedCandles(underlying, true, strategy.timeframe);
    const warmup = evaluateStrategySignal({ strategy, candles: bars, candleTimestampBasis: 'CLOSE' });
    const lastTime = bars.length ? Date.parse(String(bars[bars.length - 1]!.timestamp)) : NaN;
    const historyReady = warmup.isWarmedUp && Number.isFinite(lastTime) && lastTime <= Date.now() && Date.now() - lastTime <= (timeframe + 1) * 60000;
    check('closed-bars', 'Confirmed indicator history', config.tradingMode === TradeMode.PAPER || historyReady,
      historyReady ? 'Verified indicator history is ready.' : `Waiting for recent confirmed ${strategy.timeframe} history. ${warmup.reasons.join(' ')} Entries require verified complete bars.`);
    return { passed: checks.every((item) => item.passed), evaluatedAt: new Date().toISOString(), checks };
  }

  public async tick(session: DailyBotSession, checkpoint?: SessionCheckpoint): Promise<void> {
    if (this.working.has(session.id)) return;
    this.working.add(session.id);
    try {
      session.lastHeartbeatAt = new Date().toISOString();
      const open = session.trades.filter((trade) => trade.status !== 'CLOSED');
      for (const trade of open) await this.protect(session, trade, checkpoint);
      if (session.status !== 'RUNNING' || session.trades.some((trade) => trade.status !== 'CLOSED')) return;
      if (!this.matchesMode(session.config)) { session.status = 'PAUSED'; this.reservations.disarm(); this.event(session, 'MODE_CHANGED', 'The global trading mode changed. Review this saved setup before resuming.'); return; }
      if (this.exitDue(session)) {
        session.status = 'COMPLETED';
        this.reservations.disarm();
        session.stoppedAt = new Date().toISOString();
        this.event(session, 'SESSION_COMPLETED', 'Trading-day cutoff reached; entries are closed.');
        return;
      }
      if (!this.entryWindow(session)) {
        session.lastMessage = `Waiting for ${session.config.entryStartTime}–${session.config.lastEntryTime} IST entry window.`;
        return;
      }
      if (this.sessionLoss(session) >= session.config.dailyMaxLossAllIn || session.tradesExecuted >= Math.min(session.config.maximumTradesPerDay, session.strategySnapshot.risk?.maxTradesPerDay ?? session.config.maximumTradesPerDay) || this.reservations.isKillSwitchActive() || !this.reservations.isArmed()) {
        session.status = 'PAUSED';
        this.reservations.disarm();
        this.event(session, 'ENTRY_LIMIT_REACHED', 'New entries paused because a daily trade, loss, or account risk limit was reached.');
        return;
      }
      if (!this.reentryAllowed(session)) return;
      if (session.pendingProposal && Date.parse(session.pendingProposal.expiresAt) > Date.now()) return;
      session.pendingProposal = null;
      session.pendingProposalId = null;
      const interval = strategyTimeframeMinutes(session.strategySnapshot.timeframe) * 60000;
      const scanBar = String(Math.floor(Date.now() / interval));
      if (session.lastScanBar === scanBar) return;
      session.lastScanBar = scanBar;
      const preflight = await this.preflight(session.config, session.strategySnapshot, session);
      if (!preflight.passed) {
        this.event(session, 'SCAN_BLOCKED', preflight.checks.filter((item) => !item.passed).map((item) => item.message).join(' '));
        return;
      }
      const strategy = this.effectiveStrategy(session);
      const result = await this.coordinator.runStrategyWorkflow(strategy, { strictMarketData: true });
      if (!result.proposal) {
        this.event(session, 'NO_ENTRY_SIGNAL', result.task.resultSummary);
        return;
      }
      const invocation = result.task.toolsInvoked.find((item) => item.tool === AgentToolName.CALCULATE_INDICATORS);
      const signalTime = invocation?.output?.lastClosedCandleTime;
      const timestamp = Date.parse(String(signalTime));
      if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > interval + 60000) {
        this.event(session, 'SIGNAL_BLOCKED', 'The signal has no recent confirmed closed-bar timestamp.');
        return;
      }
      const signalKey = `${strategy.id}:${result.proposal.instrumentKey}:${strategy.timeframe}:${timestamp}`;
      if (session.processedSignalKeys.includes(signalKey)) return;
      session.pendingProposalId = result.proposal.id;
      session.pendingProposal = result.proposal;
      this.proposals.addProposal(result.proposal);
      if (this.isLive()) { this.event(session, 'OWNER_APPROVAL_REQUIRED', 'Live signal is ready. Review and explicitly approve this entry before the proposal expires.'); await checkpoint?.(session); }
      else await this.enter(session, result.proposal, signalKey, checkpoint);
    } catch (error: unknown) {
      this.reservations.disarm();
      this.event(session, 'RUNTIME_ERROR', this.message(error));
      session.status = 'ERROR';
    } finally {
      this.working.delete(session.id);
    }
  }

  public async approveEntry(session: DailyBotSession, checkpoint?: SessionCheckpoint): Promise<void> {
    if (session.status !== 'RUNNING' || !session.pendingProposal || this.working.has(session.id)) throw new BadRequestException('There is no pending entry in a running bot session.');
    this.working.add(session.id);
    try {
      const preflight = await this.preflight(session.config, session.strategySnapshot, session);
      if (!preflight.passed) throw new BadRequestException({ message: 'Entry approval preflight failed', preflight });
      const bars = this.tools.getClosedCandles(this.underlyingKey(session.strategySnapshot), true, session.strategySnapshot.timeframe);
      const time = bars[bars.length - 1]?.timestamp;
      const timestamp = Date.parse(String(time));
      const interval = strategyTimeframeMinutes(session.strategySnapshot.timeframe) * 60000;
      if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > interval + 60000) throw new BadRequestException('A recent verified closed bar is required to approve this entry.');
      const signal = evaluateStrategySignal({ strategy: this.effectiveStrategy(session), candles: bars, currentTimeIst: this.istClock().time, candleTimestampBasis: 'CLOSE' });
      const instrument = this.catalog.getInstrument(session.pendingProposal.instrumentKey);
      if (!instrument || (instrument.instrumentType === InstrumentType.CE ? !signal.bullishSignal : !signal.bearishSignal)) throw new BadRequestException('The approved entry no longer matches the verified current strategy signal.');
      await this.enter(session, session.pendingProposal, `${session.strategySnapshot.id}:${session.pendingProposal.instrumentKey}:${session.strategySnapshot.timeframe}:${timestamp}`, checkpoint);
    } finally { this.working.delete(session.id); }
  }

  public async stop(session: DailyBotSession, emergency: boolean, checkpoint?: SessionCheckpoint): Promise<void> {
    this.reservations.disarm();
    session.pendingProposalId = null;
    session.pendingProposal = null;
    session.status = emergency ? 'STOPPING' : 'STOPPED';
    session.stoppedAt = new Date().toISOString();
    if (emergency) {
      this.reservations.setKillSwitch(true);
      for (const trade of session.trades.filter((item) => item.status !== 'CLOSED')) await this.exit(session, trade, 'EMERGENCY_EXIT', checkpoint);
      session.status = session.trades.some((trade) => trade.status !== 'CLOSED') ? 'ERROR' : 'STOPPED';
    }
    this.event(session, emergency ? 'EMERGENCY_STOP' : 'SESSION_STOPPED', emergency ? 'Account entries blocked; emergency sell attempts require confirmed fills.' : 'New entries stopped. Existing position stops remain managed by the backend until exit.');
  }

  private async enter(session: DailyBotSession, proposal: TradeProposal, signalKey: string, checkpoint?: SessionCheckpoint): Promise<void> {
    const live = this.isLive();
    const modeRevision = this.router?.getModeRevision();
    const approvedProposal = JSON.stringify(proposal);
    const approvedStrategy = JSON.stringify(session.strategySnapshot);
    const approvedConfig = JSON.stringify(session.config);
    if (!this.entryWindow(session) || session.status !== 'RUNNING' || !this.matchesMode(session.config) || this.reservations.isKillSwitchActive() || !this.reentryAllowed(session)) throw new BadRequestException('New entries are blocked by the current bot state, trading mode, cooldown, or entry window.');
    this.reservations.assertEntryAllowed();
    if (this.isLive() && !this.liveAuthorized()) throw new BadRequestException('Live execution is blocked until the complete owner verification checklist is signed and permitted.');
    if (session.trades.some((trade) => trade.status !== 'CLOSED') || session.processedSignalKeys.includes(signalKey) || session.trades.some((trade) => trade.proposalId === proposal.id)) return;
    if (session.tradesExecuted >= Math.min(session.config.maximumTradesPerDay, session.strategySnapshot.risk?.maxTradesPerDay ?? session.config.maximumTradesPerDay) || Date.parse(proposal.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(proposal.expiresAt)) || proposal.strategyId !== session.config.strategyId || proposal.strategyVersion !== session.strategySnapshot.version) throw new BadRequestException('The daily trade count, strategy version, or proposal expiry blocks this entry.');
    if ((this.isLive() && !proposal.versionHash) || (proposal.versionHash && proposal.versionHash !== session.strategySnapshot.versionHash)) throw new BadRequestException('The proposal does not match the immutable saved strategy hash.');
    const quote = this.feed.getQuote(proposal.instrumentKey);
    const underlying = this.feed.getQuote(this.underlyingKey(session.strategySnapshot));
    if (!this.fresh(quote) || !this.fresh(underlying, false)) throw new BadRequestException('Fresh observed underlying and executable option depth are required before placing the order.');
    const instrument = this.catalog.getInstrument(proposal.instrumentKey);
    const allowed = instrument?.instrumentType === InstrumentType.CE ? AllowedOptionType.LONG_CALL : AllowedOptionType.LONG_PUT;
    if (!instrument || ![InstrumentType.CE, InstrumentType.PE].includes(instrument.instrumentType) || instrument.underlying !== session.strategySnapshot.underlying || !session.strategySnapshot.allowedInstruments.includes(allowed) || proposal.side !== OrderSide.BUY || proposal.product !== ProductType.I || proposal.quantity % instrument.lotSize !== 0 || proposal.quantity <= 0 || (instrument.expiry && instrument.expiry.slice(0, 10) < session.config.tradingDate)) throw new BadRequestException('Only owned-direction intraday option lots in the selected strategy universe may be opened.');
    const spread = ((quote.askPrice - quote.bidPrice) / quote.askPrice) * 100;
    if (spread > (session.strategySnapshot.entry?.maxBidAskSpreadPct ?? 1) || quote.volume < (session.strategySnapshot.entry?.minVolume ?? 1000)) throw new BadRequestException('The executable quote no longer meets strategy liquidity limits.');
    const entry = this.ceilTick(quote.askPrice + 0.25, instrument.tickSize);
    const slippage = this.money(entry * proposal.quantity * 0.02);
    const effective = this.effectiveStrategy(session);
    const exits = strategyExitLevels({ strategy: effective, entryPrice: entry, quantity: proposal.quantity, slippageBufferInr: slippage + 0.25 * proposal.quantity, tickSize: instrument.tickSize });
    if (exits.error) throw new BadRequestException(exits.error);
    // A legacy budget-derived stop is recomputed for the executable entry. Explicit AST distances remain exact.
    const explicitStop = session.strategySnapshot.astConfig?.exitRules?.stopLossValue ?? session.strategySnapshot.exit?.stopLossPoints;
    const stop = this.ceilTick(explicitStop === undefined ? Math.max(proposal.suggestedStopPrice, exits.stopPrice!) : exits.stopPrice!, instrument.tickSize);
    if (!Number.isFinite(stop) || stop <= 0 || stop >= entry) throw new BadRequestException('A valid protective stop below entry is required.');
    const charges = calculateOptionCharges({ buyPrice: entry, sellPrice: Math.max(1, stop - 0.25), quantity: proposal.quantity }).totalRoundTripCharges;
    const capital = this.money(entry * proposal.quantity);
    const allInLoss = this.money((entry - stop + 0.25) * proposal.quantity + charges + slippage);
    const riskCap = Math.min(session.config.perTradeMaxLossAllIn, effective.risk!.maxAllInTradeLossInr, session.config.dailyMaxLossAllIn - this.sessionLoss(session));
    if (charges > effective.risk!.maxRoundTripCostBudgetInr || allInLoss > riskCap || capital + charges + slippage > Math.min(effective.risk!.maxCapitalInr, session.config.maxCapitalPerTrade, session.config.dailyCapitalBudget - this.sessionLoss(session))) throw new BadRequestException('Confirmed executable price, fees, and slippage exceed the configured trade capital or all-in loss budget.');
    const assertDispatchBoundary = (): void => {
      try {
        if (this.isLive() !== live || (this.router && this.router.getModeRevision() !== modeRevision) || !this.matchesMode(session.config)) throw new Error('Trading mode changed before entry dispatch.');
        if (session.status !== 'RUNNING' || !this.entryWindow(session) || !this.reentryAllowed(session) || session.trades.some((trade) => trade.status !== 'CLOSED')) throw new Error('Session, calendar, entry time, existing exposure or cooldown no longer permits a BUY.');
        this.reservations.assertEntryAllowed();
        if (live && (!this.env.config.LIVE_EXECUTION_ENABLED || !this.liveAuthorized())) throw new Error('Owner go-live authorization changed before dispatch; no BUY was submitted.');
        if (session.pendingProposalId !== proposal.id || session.pendingProposal?.id !== proposal.id || JSON.stringify(proposal) !== approvedProposal || JSON.stringify(session.strategySnapshot) !== approvedStrategy || JSON.stringify(session.config) !== approvedConfig) throw new Error('The exact approved proposal or saved strategy configuration changed before dispatch.');
        if (!Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now() || proposal.strategyId !== session.config.strategyId || proposal.strategyVersion !== session.strategySnapshot.version || (live && !proposal.versionHash) || (proposal.versionHash && proposal.versionHash !== session.strategySnapshot.versionHash)) throw new Error('Proposal approval, expiry or immutable strategy hash no longer permits entry.');
        const currentInstrument = this.catalog.getInstrument(proposal.instrumentKey);
        if (!currentInstrument || JSON.stringify(currentInstrument) !== JSON.stringify(instrument)) throw new Error('Contract metadata changed or expired before dispatch.');
        const current = this.feed.getQuote(proposal.instrumentKey);
        const spot = this.feed.getQuote(this.underlyingKey(session.strategySnapshot));
        if (!this.fresh(current) || !this.fresh(spot, false)) throw new Error('Fresh executable option depth and observed underlying data are required at BUY dispatch.');
        const selection = session.strategySnapshot.astConfig?.contractSelection;
        const spreadPct = (current.askPrice - current.bidPrice) / current.askPrice * 100;
        if (![current.volume, current.openInterest].every(Number.isFinite) || spreadPct > (selection?.maxBidAskSpreadPct ?? session.strategySnapshot.entry?.maxBidAskSpreadPct ?? 1) || current.volume < (selection?.minVolume ?? session.strategySnapshot.entry?.minVolume ?? 1000) || current.openInterest < (selection?.minOpenInterest ?? 0) || current.askPrice < (selection?.minPremium ?? 0) || current.askPrice > (selection?.maxPremium ?? Infinity)) throw new Error('Current option depth no longer satisfies the approved strategy liquidity rules.');
        const executable = live ? current.askPrice : this.ceilTick(current.askPrice + 0.25, instrument.tickSize);
        if (executable > entry) throw new Error('Current executable ask exceeds the reserved maximum entry price.');
        const bars = this.tools.getClosedCandles(this.underlyingKey(session.strategySnapshot), true, session.strategySnapshot.timeframe);
        const signal = evaluateStrategySignal({ strategy: this.effectiveStrategy(session), candles: bars, currentTimeIst: this.istClock().time, candleTimestampBasis: 'CLOSE' });
        if (instrument.instrumentType === InstrumentType.CE ? !signal.bullishSignal : !signal.bearishSignal) throw new Error('The approved direction no longer matches the verified closed-bar strategy signal.');
      } catch (error) { throw new DailyEntryDispatchRefusal(this.message(error)); }
    };
    const existing = (await this.broker.getPositions()).filter((position) => position.netQuantity !== 0);
    assertDispatchBoundary();
    if (existing.length) throw new BadRequestException('Existing broker exposure must be reconciled before opening another position.');
    const reservation = this.reservations.acquireReservation({ proposalId: proposal.id, signalKey, instrumentKey: proposal.instrumentKey, capitalRequired: capital + charges + slippage, allInRisk: allInLoss, maxTradeRiskCap: riskCap, maxCapitalCap: session.config.maxCapitalPerTrade, maxDailyRiskCap: session.config.dailyMaxLossAllIn });
    const ownsIntent = !live || this.liveLedger!.tryLockIntent(reservation.id);
    if (!ownsIntent) { this.reservations.releaseReservation(reservation.id, 'Entry intent is already being managed.'); throw new BadRequestException('Entry protection is already being managed by another server workflow.'); }
    // Record intent before any asynchronous dispatch; replayed signals cannot place another order.
    session.processedSignalKeys.push(signalKey);
    let dispatched = false;
    let acknowledged = false;
    let confirmedTerminalNoFill = false;
    try {
      this.event(session, 'ENTRY_SUBMITTING', `Entry intent ${reservation.id} recorded for ${proposal.symbol}; awaiting confirmed broker fill.`);
      await checkpoint?.(session);
      assertDispatchBoundary();
      dispatched = true;
      const ack = await this.broker.placeOrder({ intentId: reservation.id, proposalId: proposal.id, reservationId: reservation.id, signalKey, reservedCapital: capital + charges + slippage, reservedRisk: allInLoss, tag: `DAILY_${session.id}`, instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, orderType: live ? OrderType.LIMIT : OrderType.MARKET, price: live ? entry : undefined, product: ProductType.I, quantity: proposal.quantity, stopLossPrice: stop, targetPrice: exits.targetPrice, disableTarget: true, estimatedCharges: charges, maximumExecutionPrice: entry, expectedModeRevision: modeRevision, beforeBuyDispatch: assertDispatchBoundary });
      acknowledged = true;
      if (ack.status === 'REJECTED') {
        confirmedTerminalNoFill = true;
        this.reservations.releaseReservation(reservation.id, ack.message);
        this.event(session, 'ENTRY_REJECTED', ack.message);
        session.pendingProposalId = null;
        session.pendingProposal = null;
        await checkpoint?.(session);
        return;
      }
      let confirmation = this.router ? await this.router.confirmFill(ack, proposal.quantity) : undefined;
      if (this.isLive() && confirmation && !confirmation.complete && !confirmation.terminal) {
        // Cancel the known unfilled BUY remainder before freezing; acceptance alone is not a cancellation proof.
        try {
          for (const id of ack.orderIds ?? [ack.orderId]) await this.router!.cancelOrder(id);
          confirmation = await this.router!.confirmFill(ack, proposal.quantity);
        } catch (error) { this.event(session, 'ENTRY_CANCEL_UNVERIFIED', `The pending BUY remainder could not be verified cancelled: ${this.message(error)}. Review broker orders immediately.`); }
      }
      const fills = this.broker.getFills().filter((fill) => (ack.orderIds ?? [ack.orderId]).includes(fill.orderId) && fill.side === OrderSide.BUY);
      const quantity = fills.reduce((sum, fill) => sum + fill.fillQty, 0);
      if (confirmation?.terminal && confirmation.filledQuantity === 0) confirmedTerminalNoFill = true;
      if (this.isLive() && confirmation?.terminal && !confirmation.complete && quantity > 0 && quantity < proposal.quantity && quantity === confirmation.filledQuantity && confirmation.averagePrice > 0) {
        // Cancellation plus verified terminal partial fills establishes actual owned exposure.
        // Record it as ERROR, never as a complete approved trade, and protect that actual quantity.
        const price = confirmation.averagePrice;
        this.reservations.commitReservationToPosition(reservation.id, this.money(price * quantity));
        const partial: DailyBotTrade = { proposalId: proposal.id, orderId: ack.orderId, instrumentKey: proposal.instrumentKey, symbol: proposal.symbol, quantity,
          entryPrice: price, currentPrice: price, stopPrice: stop, initialStopPrice: stop, peakNetProfit: 0, protectedNetProfit: -allInLoss, trailingActive: false,
          status: 'ERROR', realizedNetPnl: 0, estimatedCharges: calculateOptionCharges({ buyPrice: price, sellPrice: Math.max(instrument.tickSize, stop), quantity }).totalRoundTripCharges,
          reservationId: reservation.id, signalKey, tickSize: instrument.tickSize, instrumentSnapshot: structuredClone(instrument), openedAt: new Date().toISOString(), closedAt: null };
        session.trades.push(partial);
        session.tradesExecuted++;
        session.status = 'ERROR';
        this.reservations.setKillSwitch(true);
        try {
          const protection = await this.router!.placeProtectiveExit({ instrumentKey: partial.instrumentKey, quantity, stopLossPrice: stop, targetPrice: exits.targetPrice, entryIntentId: reservation.id });
          if (!protection.gttOrderId) throw new Error('Partial-fill protection was not verified.');
          partial.gttId = protection.gttOrderId;
          this.event(session, 'PARTIAL_ENTRY_PROTECTED', `Only ${quantity}/${proposal.quantity} units were broker-confirmed before cancellation. That actual quantity has a verified stop; entries remain frozen pending reconciliation.`);
          session.pendingProposalId = null;
          session.pendingProposal = null;
          await checkpoint?.(session);
        } catch (error) {
          this.event(session, 'PARTIAL_PROTECTION_FAILED', `Terminal partial exposure could not obtain verified protection: ${this.message(error)}. Attempting the shared owned exit.`);
          await this.exit(session, partial, 'PROTECTION_FAILED', checkpoint);
        }
        return;
      }
      if (quantity !== proposal.quantity || (confirmation && !confirmation.complete)) {
        this.reservations.setKillSwitch(true);
        throw new BadRequestException('Entry remains pending, partial, or ambiguous. Its durable intent and full risk reservation are retained for broker reconciliation.');
      }
      const fillPrice = fills.reduce((sum, fill) => sum + fill.fillPrice * fill.fillQty, 0) / quantity;
      const actualEntryCharges = this.money(fills.reduce((sum, fill) => sum + fill.actualCharges, 0));
      this.reservations.commitReservationToPosition(reservation.id, this.money(fillPrice * quantity));
      const trade: DailyBotTrade = { proposalId: proposal.id, orderId: ack.orderId, instrumentKey: proposal.instrumentKey, symbol: proposal.symbol, quantity, entryPrice: fillPrice, currentPrice: fillPrice, stopPrice: stop, initialStopPrice: stop, peakNetProfit: 0, protectedNetProfit: -allInLoss, trailingActive: false, status: 'OPEN', realizedNetPnl: 0, estimatedCharges: charges, entryActualCharges: this.isLive() ? undefined : actualEntryCharges, reservationId: reservation.id, signalKey, tickSize: instrument.tickSize, instrumentSnapshot: structuredClone(instrument), grossPnl: 0, netPnl: -charges, openedAt: new Date().toISOString(), closedAt: null, exitOrderId: null, exitPrice: null, exitReason: null };
      session.trades.push(trade);
      session.tradesExecuted++;
      if (this.isLive()) {
        // One verified SINGLE SELL GTT protects the actual complete fill; targets are server-owned.
        try {
          const protection = await this.router!.placeProtectiveExit({ instrumentKey: trade.instrumentKey, quantity, stopLossPrice: stop, targetPrice: exits.targetPrice, entryIntentId: reservation.id });
          trade.gttId = protection.gttOrderId;
          if (!trade.gttId) throw new Error('Broker protective stop was not verified.');
        } catch (error) {
          this.reservations.setKillSwitch(true);
          this.event(session, 'PROTECTION_FAILED', `Broker stop could not be verified: ${this.message(error)}. Attempting a shared owned emergency exit.`);
          await checkpoint?.(session);
          await this.exit(session, trade, 'PROTECTION_FAILED', checkpoint);
          session.status = 'ERROR';
          session.pendingProposalId = null;
          session.pendingProposal = null;
          return;
        }
      }
      proposal.status = ProposalStatus.APPROVED;
      this.event(session, 'ENTRY_FILLED', `${quantity} ${proposal.symbol} units filled at ₹${fillPrice.toFixed(2)} with initial stop ₹${stop.toFixed(2)}.`);
      session.pendingProposalId = null;
      session.pendingProposal = null;
      await checkpoint?.(session);
    } catch (error) {
      // Absence of a fill is never proof that a dispatched live BUY failed.
      if (!dispatched || confirmedTerminalNoFill || (!acknowledged && (error instanceof DailyEntryDispatchRefusal || (error instanceof BrokerRequestError && error.definiteRejection)))) {
        this.reservations.releaseReservation(reservation.id, this.message(error));
        session.pendingProposalId = null;
        session.pendingProposal = null;
        this.event(session, 'ENTRY_NOT_DISPATCHED', `Known no-fill refusal: ${this.message(error)}. Its held reservation was released; no unresolved broker fill was assumed.`);
        await checkpoint?.(session);
      } else {
        session.status = 'ERROR';
        this.reservations.setKillSwitch(true);
        this.event(session, 'ENTRY_RECONCILIATION_REQUIRED', 'Dispatched entry outcome is unresolved. Its pending proposal, consumed signal and risk reservation remain durable.');
        await checkpoint?.(session);
      }
      throw error;
    } finally {
      if (live) this.liveLedger!.unlockIntent(reservation.id);
    }
  }

  private async protect(session: DailyBotSession, trade: DailyBotTrade, checkpoint?: SessionCheckpoint): Promise<void> {
    // A setup in a different mode must never inspect or sell the other broker's position.
    if (!this.matchesMode(session.config)) { session.status = 'ERROR'; this.event(session, 'MODE_RECONCILIATION_REQUIRED', 'Saved exposure belongs to another trading mode. Switch back and reconcile before continuing.'); return; }
    const position = (await this.broker.getPositions()).find((item) => item.instrumentKey === trade.instrumentKey);
    if (!position && await this.reconcileExternalExit(session, trade)) return;
    if (!position || position.netQuantity !== trade.quantity || !trade.reservationId || this.reservations.getReservation(trade.reservationId)?.status !== 'COMMITTED') {
      session.status = 'ERROR';
      trade.status = 'ERROR';
      this.reservations.setKillSwitch(true);
      this.event(session, 'RECONCILIATION_REQUIRED', 'Owned position or reservation could not be reconciled. Account entries are frozen; review broker exposure before continuing.');
      return;
    }
    if (this.exitDue(session) || session.status === 'STOPPING' || trade.status === 'EXIT_PENDING') {
      await this.exit(session, trade, trade.exitReason ?? (this.exitDue(session) ? 'MANDATORY_CUTOFF' : 'EMERGENCY_EXIT'), checkpoint);
      return;
    }
    const exitRules = session.strategySnapshot.astConfig?.exitRules;
    const bars = this.tools.getClosedCandles(this.underlyingKey(session.strategySnapshot), true, session.strategySnapshot.timeframe);
    if (exitRules?.maxHoldingBars && trade.openedAt && bars.filter((bar) => Date.parse(String(bar.timestamp)) > Date.parse(trade.openedAt!)).length >= exitRules.maxHoldingBars) {
      await this.exit(session, trade, 'MAX_HOLDING_BARS', checkpoint); return;
    }
    const latestBar = bars.at(-1);
    const recentPostEntryBar = latestBar && trade.openedAt && Date.parse(String(latestBar.timestamp)) > Date.parse(trade.openedAt) && Date.now() - Date.parse(String(latestBar.timestamp)) <= (strategyTimeframeMinutes(session.strategySnapshot.timeframe) + 1) * 60000;
    if (exitRules?.exitOnOppositeSignal && recentPostEntryBar) {
      const signal = evaluateStrategySignal({ strategy: session.strategySnapshot, candles: bars, candleTimestampBasis: 'CLOSE' });
      const kind = (this.catalog.getInstrument(trade.instrumentKey) ?? trade.instrumentSnapshot)?.instrumentType;
      if ((kind === InstrumentType.CE && signal.bearishSignal) || (kind === InstrumentType.PE && signal.bullishSignal)) { await this.exit(session, trade, 'OPPOSITE_SIGNAL', checkpoint); return; }
    }
    const quote = this.feed.getQuote(trade.instrumentKey);
    if (!this.fresh(quote)) {
      this.event(session, 'PROTECTION_WAITING', 'Stop monitoring is waiting for a fresh executable bid; stale quotes cannot trigger simulated fills or change the stop.');
      return;
    }
    const exitPrice = Math.max(1, quote.bidPrice - 0.25);
    trade.currentPrice = quote.bidPrice;
    trade.estimatedCharges = this.roundTripCharges(trade, exitPrice);
    trade.grossPnl = this.money((exitPrice - trade.entryPrice) * trade.quantity);
    trade.netPnl = this.money(trade.grossPnl - trade.estimatedCharges);
    trade.peakNetProfit = Math.max(trade.peakNetProfit, trade.netPnl);
    if (quote.bidPrice <= trade.stopPrice) {
      await this.exit(session, trade, trade.trailingActive ? 'TRAILING_STOP' : 'INITIAL_STOP', checkpoint);
      return;
    }
    const levels = strategyExitLevels({ strategy: session.strategySnapshot, entryPrice: trade.entryPrice, quantity: trade.quantity, tickSize: trade.tickSize });
    if (levels.error) { this.event(session, 'UNSUPPORTED_EXIT_RULE', levels.error); }
    else if (quote.bidPrice >= levels.targetPrice!) { await this.exit(session, trade, 'STRATEGY_TARGET', checkpoint); return; }
    if (trade.netPnl >= session.config.minNetProfitToActivateTrailing || trade.trailingActive) {
      const tick = trade.tickSize ?? this.catalog.getInstrument(trade.instrumentKey)?.tickSize ?? 0.05;
      const step = Math.max(0, Math.floor((trade.peakNetProfit - session.config.minNetProfitToActivateTrailing) / session.config.trailingStepProfit));
      let lock = session.config.desiredNetProfitLock + (session.config.trailingAlgorithm === 'STEP_LOCK' ? step * session.config.trailingStepLock : 0);
      if (session.config.trailingAlgorithm === 'FIXED_PERCENT') {
        const peakExit = trade.entryPrice + (trade.peakNetProfit + trade.estimatedCharges) / trade.quantity;
        const percentStop = peakExit * (1 - session.config.trailingPercent / 100);
        lock = Math.max(lock, (percentStop - trade.entryPrice) * trade.quantity - trade.estimatedCharges);
      }
      const candidate = this.ceilTick(trade.entryPrice + (lock + trade.estimatedCharges) / trade.quantity + 0.25, tick);
      if (candidate > trade.stopPrice && candidate <= quote.bidPrice - tick && (this.isLive() || this.paperBroker.tightenProtectiveStop(trade.instrumentKey, trade.quantity, candidate))) {
        trade.stopPrice = candidate;
        trade.trailingActive = true;
        trade.protectedNetProfit = this.money((candidate - 0.25 - trade.entryPrice) * trade.quantity - this.roundTripCharges(trade, candidate - 0.25));
        this.event(session, 'STOP_TIGHTENED', `${this.isLive() ? 'Server trailing threshold' : 'Simulator trailing stop'} tightened to ₹${candidate.toFixed(2)}; estimated net threshold ₹${trade.protectedNetProfit.toFixed(2)} including fees and slippage.${this.isLive() ? ' The original broker GTT remains armed; tighter trailing requires the API and fresh quotes, and execution price is not guaranteed.' : ''}`);
        await checkpoint?.(session);
      }
    }
  }

  private async exit(session: DailyBotSession, trade: DailyBotTrade, reason: string, checkpoint?: SessionCheckpoint): Promise<void> {
    if (trade.status === 'CLOSED') return;
    trade.status = 'EXIT_PENDING';
    trade.exitReason = reason;
    const quote = this.feed.getQuote(trade.instrumentKey);
    if (!this.isLive() && !this.fresh(quote)) {
      this.event(session, 'EXIT_WAITING', 'Exit remains pending because the executable quote is stale. Position and risk reservation remain open.');
      return;
    }
    this.event(session, 'EXIT_SUBMITTING', `${reason}: owned sell intent recorded; awaiting confirmed fill for ${trade.quantity} units.`);
    try { await checkpoint?.(session); } catch (error) {
      this.reservations.disarm();
      if (!this.isLive() || !this.orders || !['EMERGENCY_EXIT', 'PROTECTION_FAILED', 'MANDATORY_CUTOFF'].includes(reason)) throw error;
      // The shared live order ledger still records the SELL intent before dispatch.
      this.event(session, 'EXIT_CHECKPOINT_UNAVAILABLE', 'Daily session storage failed. The emergency owned exit proceeds through the independent durable live order ledger.');
    }
    if (this.orders) {
      const result = await this.orders.closePosition(trade.instrumentKey);
      if (!result.success || !this.applyExitResult(trade, result, reason)) {
        this.event(session, 'EXIT_RECONCILIATION_REQUIRED', result.message);
        await checkpoint?.(session); return;
      }
      this.event(session, 'EXIT_FILLED', `${reason}: ${result.message} Net P&L ₹${trade.realizedNetPnl.toFixed(2)} (${this.isLive() ? 'estimated broker fees' : 'simulated fees'}).`);
      await checkpoint?.(session); return;
    }
    if (this.isLive()) throw new BadRequestException('The shared owned-exit service is required for live exits.');
    trade.exitIntentId ??= `${session.id}:${trade.orderId}:exit`;
    const ack = await this.paperBroker.placeOrder({ intentId: trade.exitIntentId, tag: `DAILY_EXIT_${reason}`, instrumentKey: trade.instrumentKey, side: OrderSide.SELL, orderType: OrderType.MARKET, product: ProductType.I, quantity: trade.quantity });
    if (ack.status === 'REJECTED') {
      trade.exitIntentId = undefined; // A confirmed zero-fill rejection permits a new attempt.
      this.event(session, 'EXIT_REJECTED', `${ack.message} Position and risk reservation remain open; the backend will retry with a fresh quote.`);
      await checkpoint?.(session);
      return;
    }
    const fills = this.broker.getFills().filter((fill) => fill.orderId === ack.orderId && fill.side === OrderSide.SELL);
    const quantity = fills.reduce((sum, fill) => sum + fill.fillQty, 0);
    if (quantity !== trade.quantity || (await this.broker.getPositions()).some((position) => position.instrumentKey === trade.instrumentKey && position.netQuantity !== 0)) {
      session.status = 'ERROR';
      this.reservations.setKillSwitch(true);
      this.event(session, 'EXIT_RECONCILIATION_REQUIRED', 'Exit has no complete confirmed fill. Position risk is retained for manual reconciliation.');
      return;
    }
    const price = fills.reduce((sum, fill) => sum + fill.fillPrice * fill.fillQty, 0) / quantity;
    const charges = this.money((trade.entryActualCharges ?? this.roundTripCharges(trade, price) - fills.reduce((sum, fill) => sum + fill.actualCharges, 0)) + fills.reduce((sum, fill) => sum + fill.actualCharges, 0));
    const gross = this.money((price - trade.entryPrice) * quantity);
    const pnl = this.money(gross - charges);
    if (!trade.reservationId || !this.reservations.settleReservation(trade.reservationId, pnl)) {
      session.status = 'ERROR';
      this.event(session, 'SETTLEMENT_REQUIRED', 'Exit filled but its reservation could not be settled; manual account reconciliation is required.');
      return;
    }
    trade.status = 'CLOSED';
    trade.exitOrderId = ack.orderId;
    trade.exitPrice = price;
    trade.currentPrice = price;
    trade.closedAt = new Date().toISOString();
    trade.grossPnl = gross;
    trade.netPnl = pnl;
    trade.realizedNetPnl = pnl;
    trade.estimatedCharges = charges;
    this.event(session, 'EXIT_FILLED', `${reason}: confirmed sell fill at ₹${price.toFixed(2)}; realized net P&L ₹${pnl.toFixed(2)} after ₹${charges.toFixed(2)} charges.`);
    if (this.exitDue(session) && session.status === 'RUNNING') { session.status = 'COMPLETED'; session.stoppedAt = new Date().toISOString(); }
    await checkpoint?.(session);
  }

  private async reconcileExternalExit(session: DailyBotSession, trade: DailyBotTrade): Promise<boolean> {
    if (!trade.openedAt || !trade.reservationId) return false;
    if (this.isLive()) {
      const result = await this.orders?.reconcileExternalExitIfFlat(trade.instrumentKey);
      if (result?.success && this.applyExitResult(trade, result, 'EXTERNAL_CONFIRMED_EXIT')) { this.event(session, 'EXTERNAL_EXIT_RECONCILED', result.message); return true; }
      // Another shared monitor may already have durably settled the exact owned entry.
      const entry = this.liveLedger?.getEntries().find((record) => record.reservationId === trade.reservationId && record.side === OrderSide.BUY && record.state === 'CLOSED');
      const exit = entry && this.liveLedger?.getEntries().find((record) => record.entryIntentId === entry.intentId && record.state === 'CLOSED' && record.filledQuantity === trade.quantity && record.averagePrice > 0);
      if (entry?.settledPnl !== undefined && exit && this.reservations.getReservation(trade.reservationId)?.status === 'RELEASED') {
        return this.applyExitResult(trade, { success: true, message: 'Shared live ledger already settled the exact owned exit.', orderId: exit.orderIds[0] ?? exit.intentId, quantity: exit.filledQuantity, exitPrice: exit.averagePrice, netPnl: entry.settledPnl, charges: this.money((exit.averagePrice - trade.entryPrice) * trade.quantity - entry.settledPnl) }, 'EXTERNAL_CONFIRMED_EXIT');
      }
      return false;
    }
    const sell = this.broker.getFills().find((fill) => fill.instrumentKey === trade.instrumentKey && fill.side === OrderSide.SELL && fill.fillQty === trade.quantity && Date.parse(fill.timestamp) >= Date.parse(trade.openedAt!));
    const reservation = this.reservations.getReservation(trade.reservationId);
    if (!sell || !reservation || !['COMMITTED', 'RELEASED'].includes(reservation.status)) return false;
    const charges = this.money((trade.entryActualCharges ?? this.roundTripCharges(trade, sell.fillPrice) - sell.actualCharges) + sell.actualCharges);
    const pnl = this.money((sell.fillPrice - trade.entryPrice) * trade.quantity - charges);
    if (reservation.status === 'COMMITTED' && !this.reservations.settleReservation(trade.reservationId, pnl)) return false;
    Object.assign(trade, { status: 'CLOSED', exitOrderId: sell.orderId, exitPrice: sell.fillPrice, currentPrice: sell.fillPrice, closedAt: sell.timestamp, exitReason: 'EXTERNAL_CONFIRMED_EXIT', grossPnl: this.money((sell.fillPrice - trade.entryPrice) * trade.quantity), netPnl: pnl, realizedNetPnl: pnl, estimatedCharges: charges });
    this.event(session, 'EXTERNAL_EXIT_RECONCILED', `Confirmed external sell closed the bot-owned position. Net P&L ₹${pnl.toFixed(2)}; risk settlement recorded once.`);
    return true;
  }

  private effectiveStrategy(session: DailyBotSession): StrategyConfig {
    const strategy = structuredClone(session.strategySnapshot);
    const config = session.config;
    const risk = strategy.risk;
    strategy.session = { start: [config.entryStartTime, strategy.session?.start ?? '09:15'].sort().at(-1)!, lastEntry: [config.lastEntryTime, strategy.session?.lastEntry ?? '15:10'].sort()[0]!, timezone: 'Asia/Kolkata' };
    strategy.risk = {
      maxCapitalInr: Math.min(config.maxCapitalPerTrade, config.dailyCapitalBudget - this.sessionLoss(session), risk?.maxCapitalInr ?? strategy.maxCapitalInr),
      maxAllInTradeLossInr: Math.min(config.perTradeMaxLossAllIn, config.dailyMaxLossAllIn - this.sessionLoss(session), risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr),
      maxAllInDailyLossInr: Math.min(config.dailyMaxLossAllIn, risk?.maxAllInDailyLossInr ?? strategy.maxAllInDailyLossInr),
      maxOpenPositions: 1,
      maxTradesPerDay: Math.min(config.maximumTradesPerDay, risk?.maxTradesPerDay ?? config.maximumTradesPerDay),
      targetNetProfitInr: risk?.targetNetProfitInr ?? strategy.targetNetProfitInr,
      maxRoundTripCostBudgetInr: Math.min(config.maxRoundTripCharges, risk?.maxRoundTripCostBudgetInr ?? strategy.maxRoundTripCostBudgetInr),
    };
    return strategy;
  }

  private sessionLoss(session?: DailyBotSession): number { return session?.trades.reduce((sum, trade) => sum + (trade.status === 'CLOSED' ? Math.max(0, -trade.realizedNetPnl) : 0), 0) ?? 0; }
  private roundTripCharges(trade: DailyBotTrade, exit: number): number {
    const sellCharges = calculateOptionCharges({ buyPrice: 0, sellPrice: exit, quantity: trade.quantity }).totalRoundTripCharges - 23.6;
    return this.money((trade.entryActualCharges ?? calculateOptionCharges({ buyPrice: trade.entryPrice, sellPrice: 0, quantity: trade.quantity }).totalRoundTripCharges - 23.6) + sellCharges);
  }
  private entryWindow(session: DailyBotSession): boolean { const clock = this.istClock(); const strategy = this.effectiveStrategy(session); return clock.date === session.config.tradingDate && this.isTradingDay(clock) && clock.time >= strategy.session!.start && clock.time < strategy.session!.lastEntry && !this.exitDue(session); }
  private isTradingDay(clock: { date: string; weekday: string }): boolean { return isCalendarVerifiedForDate(new Date(`${clock.date}T00:00:00.000Z`)) && clock.weekday !== 'Sat' && clock.weekday !== 'Sun' && !NSE_HOLIDAYS_2026[clock.date]; }
  private exitDue(session: DailyBotSession): boolean { const clock = this.istClock(); const cutoff = [session.config.mandatoryExitTime, session.strategySnapshot.astConfig?.exitRules?.marketCutoffTime ?? session.strategySnapshot.exit?.marketCutoff ?? session.config.mandatoryExitTime].sort()[0]!; return clock.date > session.config.tradingDate || (clock.date === session.config.tradingDate && clock.time >= cutoff); }
  private istClock(): { date: string; time: string; weekday: string } {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? '';
    return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}`, weekday: value('weekday') };
  }
  private fresh(quote: QuoteSnapshot | undefined, executable = true): quote is QuoteSnapshot {
    if (!quote) return false;
    const observed = quote.provenance === 'LIVE' || (!this.isLive() && process.env.NODE_ENV === 'test' && quote.provenance === 'SIMULATED');
    const age = Date.now() - Date.parse(quote.timestamp);
    return observed && !quote.isStale && Number.isFinite(age) && age >= -1000 && age <= 3000 && Number.isFinite(quote.lastPrice) && quote.lastPrice > 0 && (!executable || (quote.depthKnown === true && quote.bidQty > 0 && quote.askQty > 0 && Number.isFinite(quote.bidPrice) && quote.bidPrice > 0 && Number.isFinite(quote.askPrice) && quote.askPrice >= quote.bidPrice));
  }
  private liveAuthorized(): boolean {
    try { return this.goLiveChecklist?.getChecklist().liveExecutionPermitted === true; }
    catch { return false; }
  }
  private reentryAllowed(session: DailyBotSession): boolean {
    const rules = session.strategySnapshot.astConfig?.entryRules;
    const prior = session.trades.filter((trade) => trade.status === 'CLOSED').sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)))[0];
    if (!prior) return true;
    if (rules?.allowReentry === false) { session.lastMessage = 'The saved strategy prohibits reentry after its first closed trade.'; return false; }
    const closed = Date.parse(prior.closedAt ?? '');
    const interval = strategyTimeframeMinutes(session.strategySnapshot.timeframe) * 60000;
    if (!Number.isFinite(closed) || Date.now() < closed + Math.max(1, rules?.cooldownBars ?? 1) * interval) { session.lastMessage = 'Waiting for the saved strategy cooldown after the last confirmed exit.'; return false; }
    return true;
  }
  private applyExitResult(trade: DailyBotTrade, result: OwnedExitResult, reason: string): boolean {
    if (!result.success || result.quantity !== trade.quantity || !result.orderId || !Number.isFinite(result.exitPrice) || !Number.isFinite(result.netPnl) || !Number.isFinite(result.charges)) return false;
    Object.assign(trade, { status: 'CLOSED', exitOrderId: result.orderId, exitPrice: result.exitPrice, currentPrice: result.exitPrice, closedAt: new Date().toISOString(), exitReason: reason, grossPnl: this.money((result.exitPrice! - trade.entryPrice) * trade.quantity), netPnl: result.netPnl, realizedNetPnl: result.netPnl, estimatedCharges: result.charges });
    return true;
  }
  private underlyingKey(strategy: StrategyConfig): string {
    const keys: Record<string, string> = { NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank', FINNIFTY: 'NSE_INDEX|Nifty Fin Service', MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT' };
    const key = keys[strategy.underlying];
    if (!key) throw new BadRequestException('No verified supported underlying identifier is configured for this strategy.');
    return key;
  }
  private ceilTick(price: number, tick: number): number { return this.money(Math.ceil((price - 1e-9) / tick) * tick); }
  private money(value: number): number { return Number(value.toFixed(2)); }
  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  private event(session: DailyBotSession, type: string, message: string): void {
    if (session.events[session.events.length - 1]?.type === type && session.events[session.events.length - 1]?.message === message) return;
    session.lastMessage = message;
    session.events.push({ timestamp: new Date().toISOString(), type, message });
    this.gateway.broadcast('daily-bot.updated', { sessionId: session.id, type, message });
  }
}
