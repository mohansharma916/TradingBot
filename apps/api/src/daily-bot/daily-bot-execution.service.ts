import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AgentToolName, AllowedOptionType, DailyBotConfig, DailyBotConfigSchema, DailyBotPreflight,
  DailyBotSession, DailyBotTrade, InstrumentType, OrderSide, OrderType,
  ProductType, ProposalStatus, QuoteSnapshot, StrategyConfig, StrategyStatus, TradeMode, TradeProposal,
} from '@trading-bot/contracts';
import { calculateOptionCharges, NSE_HOLIDAYS_2026, validateWarmup } from '@trading-bot/domain';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { AgentToolsService } from '../agents/agent-tools.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { EnvService } from '../config/env.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { EventsGateway } from '../websocket/events.gateway';

type SessionCheckpoint = (session: DailyBotSession) => void | Promise<void>;

/** Executes the immutable daily strategy snapshot and owns protection independently of the UI. */
@Injectable()
export class DailyBotExecutionService {
  private readonly working = new Set<string>();

  constructor(
    @Inject(PaperBrokerAdapter) private readonly broker: PaperBrokerAdapter,
    @Inject(RiskReservationManager) private readonly reservations: RiskReservationManager,
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
    @Inject(AgentToolsService) private readonly tools: AgentToolsService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(ProposalsService) private readonly proposals: ProposalsService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  public restoreDailyLedger(sessions: DailyBotSession[]): Set<string> {
    // Recovery runs during provider construction, before Nest's module-init catalogue hook.
    if (this.catalog.getUnderlyingInstruments('NIFTY').length === 0) this.catalog.bootstrapCatalog();
    const today = this.istClock().date;
    this.reservations.restoreDailyResults(today, sessions.filter((session) => session.config.tradingDate === today).flatMap((session) => session.trades.filter((trade) => trade.status === 'CLOSED').map((trade) => ({ orderId: trade.orderId, realizedNetPnl: trade.realizedNetPnl }))));
    const recovered = new Set<string>();
    const exposure = sessions.flatMap((session) => session.trades.filter((trade) => trade.status !== 'CLOSED').map((trade) => ({ session, trade })));
    if (exposure.length === 0) return recovered;
    if (exposure.length !== 1) { this.reservations.setKillSwitch(true); return recovered; }
    const { session, trade } = exposure[0]!;
    const instrument = this.catalog.getInstrument(trade.instrumentKey);
    const confirmed = session.config.tradingMode === TradeMode.PAPER && session.pendingProposalId === null && trade.status === 'OPEN' &&
      trade.orderId.startsWith('ord_paper_') && trade.reservationId && trade.signalKey && trade.openedAt && Number.isFinite(Date.parse(trade.openedAt)) &&
      trade.initialStopPrice && trade.tickSize && trade.entryActualCharges !== undefined && instrument && trade.quantity % instrument.lotSize === 0 &&
      session.events.some((event) => event.type === 'ENTRY_FILLED') && session.events[session.events.length - 1]?.type !== 'EXIT_SUBMITTING';
    if (!confirmed) { this.reservations.setKillSwitch(true); return recovered; }
    try {
      const risk = this.money((trade.entryPrice - trade.initialStopPrice! + 0.25) * trade.quantity + this.roundTripCharges(trade, Math.max(1, trade.initialStopPrice! - 0.25)) + 10);
      this.reservations.restoreConfirmedPosition({ id: trade.reservationId!, proposalId: trade.proposalId, signalKey: trade.signalKey!, instrumentKey: trade.instrumentKey, reservedCapital: this.money(trade.entryPrice * trade.quantity), reservedRisk: risk, status: 'COMMITTED', createdAt: trade.openedAt! });
      this.broker.restoreConfirmedPosition(trade);
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
    check('mode', 'Execution mode', config.tradingMode === TradeMode.PAPER, config.tradingMode === TradeMode.PAPER ? 'Paper execution uses confirmed simulator fills and backend stop management.' : 'Daily Bot currently supports Paper Trading. Live approval and automation require broker-side trailing protection and reconciliation; use the existing live order workflow.');
    check('trading-date', 'Trading date', config.tradingDate === clock.date, `Configured ${config.tradingDate}; current trading date is ${clock.date} IST.`);
    check('market-session', 'Market session', this.isTradingDay(clock) && clock.time >= '09:15' && clock.time < config.lastEntryTime, `Entries require an exchange trading day between 09:15 and ${config.lastEntryTime} IST; current time is ${clock.weekday} ${clock.time}${NSE_HOLIDAYS_2026[clock.date] ? ` (${NSE_HOLIDAYS_2026[clock.date]})` : ''}.`);
    check('strategy', 'Selected strategy', strategy.id === config.strategyId && strategy.market === 'NSE_FO' && strategy.timeframe === '5m' && ![StrategyStatus.RETIRED, StrategyStatus.PAUSED, StrategyStatus.DRAFT].includes(strategy.status), 'Select an active, tested NSE F&O 5m long-option strategy.');
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
    const quote = this.feed.getQuote(underlying);
    const options = this.catalog.getUnderlyingInstruments(strategy.underlying).filter((instrument) => [InstrumentType.CE, InstrumentType.PE].includes(instrument.instrumentType));
    check('market-data', 'Fresh market data', this.fresh(quote) && options.some((instrument) => this.fresh(this.feed.getQuote(instrument.instrumentKey))), 'Fresh underlying and executable option bid/ask quotes must be available within 3 seconds.');
    const bars = this.tools.getClosedCandles(underlying, true);
    const warmup = validateWarmup(bars, strategy.entry?.emaPeriod ?? 20, strategy.entry?.rsiPeriod ?? 14);
    const lastTime = bars.length ? Date.parse(String(bars[bars.length - 1]!.timestamp)) : NaN;
    const historyReady = warmup.isWarmedUp && Number.isFinite(lastTime) && lastTime <= Date.now() && Date.now() - lastTime <= 360000;
    check('closed-bars', 'Confirmed indicator history', config.tradingMode === TradeMode.PAPER || historyReady,
      historyReady ? 'Verified indicator history is ready.' : `Paper session can monitor while waiting for recent confirmed 5m feed history (${warmup.missingCandles ?? 0} warmup candles required). Entries wait for verified bars; sample analytical history is excluded.`);
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
      if (this.exitDue(session)) {
        session.status = 'COMPLETED';
        session.stoppedAt = new Date().toISOString();
        this.event(session, 'SESSION_COMPLETED', 'Trading-day cutoff reached; entries are closed.');
        return;
      }
      if (!this.entryWindow(session)) {
        session.lastMessage = `Waiting for ${session.config.entryStartTime}–${session.config.lastEntryTime} IST entry window.`;
        return;
      }
      if (this.sessionLoss(session) >= session.config.dailyMaxLossAllIn || session.tradesExecuted >= Math.min(session.config.maximumTradesPerDay, session.strategySnapshot.risk?.maxTradesPerDay ?? session.config.maximumTradesPerDay) || this.reservations.isKillSwitchActive()) {
        session.status = 'PAUSED';
        this.event(session, 'ENTRY_LIMIT_REACHED', 'New entries paused because a daily trade, loss, or account risk limit was reached.');
        return;
      }
      const scanBar = String(Math.floor(Date.now() / 300000));
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
      if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > 360000) {
        this.event(session, 'SIGNAL_BLOCKED', 'The signal has no recent confirmed closed-bar timestamp.');
        return;
      }
      const signalKey = `${strategy.id}:${result.proposal.instrumentKey}:5m:${timestamp}`;
      if (session.processedSignalKeys.includes(signalKey)) return;
      session.pendingProposalId = result.proposal.id;
      session.pendingProposal = result.proposal;
      this.proposals.addProposal(result.proposal);
      // Start consent authorizes automatic PAPER execution. Live modes fail preflight.
      await this.enter(session, result.proposal, signalKey, checkpoint);
    } catch (error: unknown) {
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
      const bars = this.tools.getClosedCandles(this.underlyingKey(session.strategySnapshot), true);
      const time = bars[bars.length - 1]?.timestamp;
      const timestamp = Date.parse(String(time));
      if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > 360000) throw new BadRequestException('A recent verified closed bar is required to approve this entry.');
      await this.enter(session, session.pendingProposal, `${session.strategySnapshot.id}:${session.pendingProposal.instrumentKey}:5m:${Date.parse(String(time))}`, checkpoint);
    } finally { this.working.delete(session.id); }
  }

  public async stop(session: DailyBotSession, emergency: boolean, checkpoint?: SessionCheckpoint): Promise<void> {
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
    if (!this.entryWindow(session) || session.status !== 'RUNNING' || session.config.tradingMode !== TradeMode.PAPER || this.reservations.isKillSwitchActive()) throw new BadRequestException('New entries are blocked by the current bot state, trading mode, or entry window.');
    if (session.trades.some((trade) => trade.status !== 'CLOSED') || session.processedSignalKeys.includes(signalKey) || session.trades.some((trade) => trade.proposalId === proposal.id)) return;
    if (session.tradesExecuted >= Math.min(session.config.maximumTradesPerDay, session.strategySnapshot.risk?.maxTradesPerDay ?? session.config.maximumTradesPerDay) || Date.parse(proposal.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(proposal.expiresAt)) || proposal.strategyId !== session.config.strategyId || proposal.strategyVersion !== session.strategySnapshot.version) throw new BadRequestException('The daily trade count, strategy version, or proposal expiry blocks this entry.');
    const quote = this.feed.getQuote(proposal.instrumentKey);
    const underlying = this.feed.getQuote(this.underlyingKey(session.strategySnapshot));
    if (!this.fresh(quote) || !this.fresh(underlying)) throw new BadRequestException('Fresh underlying and option quotes are required before placing the order.');
    const instrument = this.catalog.getInstrument(proposal.instrumentKey);
    const allowed = instrument?.instrumentType === InstrumentType.CE ? AllowedOptionType.LONG_CALL : AllowedOptionType.LONG_PUT;
    if (!instrument || ![InstrumentType.CE, InstrumentType.PE].includes(instrument.instrumentType) || instrument.underlying !== session.strategySnapshot.underlying || !session.strategySnapshot.allowedInstruments.includes(allowed) || proposal.side !== OrderSide.BUY || proposal.product !== ProductType.I || proposal.quantity % instrument.lotSize !== 0 || proposal.quantity <= 0 || (instrument.expiry && instrument.expiry.slice(0, 10) < session.config.tradingDate)) throw new BadRequestException('Only owned-direction intraday option lots in the selected strategy universe may be opened.');
    const spread = ((quote.askPrice - quote.bidPrice) / quote.askPrice) * 100;
    if (spread > (session.strategySnapshot.entry?.maxBidAskSpreadPct ?? 1) || quote.volume < (session.strategySnapshot.entry?.minVolume ?? 1000)) throw new BadRequestException('The executable quote no longer meets strategy liquidity limits.');
    const entry = this.ceilTick(quote.askPrice + 0.25, instrument.tickSize);
    const stop = this.ceilTick(proposal.suggestedStopPrice, instrument.tickSize);
    if (!Number.isFinite(stop) || stop <= 0 || stop >= entry) throw new BadRequestException('A valid protective stop below entry is required.');
    const charges = calculateOptionCharges({ buyPrice: entry, sellPrice: Math.max(1, stop - 0.25), quantity: proposal.quantity }).totalRoundTripCharges;
    const capital = this.money(entry * proposal.quantity);
    const allInLoss = this.money((entry - stop + 0.25) * proposal.quantity + charges + 10);
    const effective = this.effectiveStrategy(session);
    const riskCap = Math.min(session.config.perTradeMaxLossAllIn, effective.risk!.maxAllInTradeLossInr, session.config.dailyMaxLossAllIn - this.sessionLoss(session));
    if (charges > effective.risk!.maxRoundTripCostBudgetInr || allInLoss > riskCap || capital + charges > Math.min(effective.risk!.maxCapitalInr, session.config.maxCapitalPerTrade, session.config.dailyCapitalBudget - this.sessionLoss(session))) throw new BadRequestException('Confirmed executable price, fees, and slippage exceed the configured trade capital or all-in loss budget.');
    const existing = (await this.broker.getPositions()).filter((position) => position.netQuantity !== 0);
    if (existing.length) throw new BadRequestException('Existing paper exposure must be reconciled before opening another position.');
    const reservation = this.reservations.acquireReservation({ proposalId: proposal.id, signalKey, instrumentKey: proposal.instrumentKey, capitalRequired: capital, allInRisk: allInLoss, maxTradeRiskCap: riskCap, maxCapitalCap: session.config.maxCapitalPerTrade, maxDailyRiskCap: session.config.dailyMaxLossAllIn });
    // Record intent before any asynchronous dispatch; replayed signals cannot place another order.
    session.processedSignalKeys.push(signalKey);
    try {
      this.event(session, 'ENTRY_SUBMITTING', `Entry intent ${reservation.id} recorded for ${proposal.symbol}; awaiting confirmed broker fill.`);
      await checkpoint?.(session);
      const ack = await this.broker.placeOrder({ intentId: reservation.id, tag: `DAILY_${session.id}`, instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: proposal.quantity, stopLossPrice: stop, disableTarget: true, estimatedCharges: charges, maximumExecutionPrice: entry });
      if (ack.status === 'REJECTED') {
        this.reservations.releaseReservation(reservation.id, ack.message);
        this.event(session, 'ENTRY_REJECTED', ack.message);
        session.pendingProposalId = null;
        session.pendingProposal = null;
        await checkpoint?.(session);
        return;
      }
      const fills = this.broker.getFills().filter((fill) => fill.orderId === ack.orderId);
      const quantity = fills.reduce((sum, fill) => sum + fill.fillQty, 0);
      if (quantity !== proposal.quantity) {
        this.reservations.setKillSwitch(true);
        throw new BadRequestException('Entry fill quantity could not be reconciled; account entries frozen for manual review.');
      }
      const fillPrice = fills.reduce((sum, fill) => sum + fill.fillPrice * fill.fillQty, 0) / quantity;
      const actualEntryCharges = this.money(fills.reduce((sum, fill) => sum + fill.actualCharges, 0));
      this.reservations.commitReservationToPosition(reservation.id, this.money(fillPrice * quantity));
      const trade: DailyBotTrade = { proposalId: proposal.id, orderId: ack.orderId, instrumentKey: proposal.instrumentKey, symbol: proposal.symbol, quantity, entryPrice: fillPrice, currentPrice: fillPrice, stopPrice: stop, initialStopPrice: stop, peakNetProfit: 0, protectedNetProfit: -allInLoss, trailingActive: false, status: 'OPEN', realizedNetPnl: 0, estimatedCharges: charges, entryActualCharges: actualEntryCharges, reservationId: reservation.id, signalKey, tickSize: instrument.tickSize, grossPnl: 0, netPnl: -charges, openedAt: new Date().toISOString(), closedAt: null, exitOrderId: null, exitPrice: null, exitReason: null };
      session.trades.push(trade);
      session.tradesExecuted++;
      proposal.status = ProposalStatus.APPROVED;
      this.event(session, 'ENTRY_FILLED', `${quantity} ${proposal.symbol} units filled at ₹${fillPrice.toFixed(2)} with initial stop ₹${stop.toFixed(2)}.`);
      session.pendingProposalId = null;
      session.pendingProposal = null;
      await checkpoint?.(session);
    } catch (error) {
      // A held reservation is retained if the broker has already filled: ambiguous states need review.
      const filled = this.broker.getFills().some((fill) => fill.instrumentKey === proposal.instrumentKey && fill.side === OrderSide.BUY);
      if (!filled) this.reservations.releaseReservation(reservation.id, this.message(error));
      throw error;
    } finally {
      session.pendingProposalId = null;
      session.pendingProposal = null;
    }
  }

  private async protect(session: DailyBotSession, trade: DailyBotTrade, checkpoint?: SessionCheckpoint): Promise<void> {
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
      if (candidate > trade.stopPrice && candidate <= quote.bidPrice - tick && this.broker.tightenProtectiveStop(trade.instrumentKey, trade.quantity, candidate)) {
        trade.stopPrice = candidate;
        trade.trailingActive = true;
        trade.protectedNetProfit = this.money((candidate - 0.25 - trade.entryPrice) * trade.quantity - this.roundTripCharges(trade, candidate - 0.25));
        this.event(session, 'STOP_TIGHTENED', `Trailing stop tightened to ₹${candidate.toFixed(2)}; modeled net profit floor ₹${trade.protectedNetProfit.toFixed(2)} including fees and slippage.`);
        await checkpoint?.(session);
      }
    }
  }

  private async exit(session: DailyBotSession, trade: DailyBotTrade, reason: string, checkpoint?: SessionCheckpoint): Promise<void> {
    if (trade.status === 'CLOSED') return;
    trade.status = 'EXIT_PENDING';
    trade.exitReason = reason;
    const quote = this.feed.getQuote(trade.instrumentKey);
    if (!this.fresh(quote)) {
      this.event(session, 'EXIT_WAITING', 'Exit remains pending because the executable quote is stale. Position and risk reservation remain open.');
      return;
    }
    this.event(session, 'EXIT_SUBMITTING', `${reason}: owned sell intent recorded; awaiting confirmed fill for ${trade.quantity} units.`);
    await checkpoint?.(session);
    const ack = await this.broker.placeOrder({ intentId: `${session.id}:${trade.orderId}:exit:${Date.now()}`, tag: `DAILY_EXIT_${reason}`, instrumentKey: trade.instrumentKey, side: OrderSide.SELL, orderType: OrderType.MARKET, product: ProductType.I, quantity: trade.quantity });
    if (ack.status === 'REJECTED') {
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
    strategy.session = { start: config.entryStartTime, lastEntry: config.lastEntryTime, timezone: 'Asia/Kolkata' };
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
  private entryWindow(session: DailyBotSession): boolean { const clock = this.istClock(); return clock.date === session.config.tradingDate && this.isTradingDay(clock) && clock.time >= session.config.entryStartTime && clock.time < session.config.lastEntryTime; }
  private isTradingDay(clock: { date: string; weekday: string }): boolean { return clock.weekday !== 'Sat' && clock.weekday !== 'Sun' && !NSE_HOLIDAYS_2026[clock.date]; }
  private exitDue(session: DailyBotSession): boolean { const clock = this.istClock(); return clock.date > session.config.tradingDate || (clock.date === session.config.tradingDate && clock.time >= session.config.mandatoryExitTime); }
  private istClock(): { date: string; time: string; weekday: string } {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? '';
    return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}`, weekday: value('weekday') };
  }
  private fresh(quote: QuoteSnapshot | undefined): quote is QuoteSnapshot { if (!quote) return false; const age = Date.now() - Date.parse(quote.timestamp); return !quote.isStale && Number.isFinite(age) && age >= -1000 && age <= 3000 && Number.isFinite(quote.bidPrice) && quote.bidPrice > 0 && Number.isFinite(quote.askPrice) && quote.askPrice >= quote.bidPrice; }
  private underlyingKey(strategy: StrategyConfig): string { return strategy.underlying === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : 'NSE_INDEX|Nifty Bank'; }
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
