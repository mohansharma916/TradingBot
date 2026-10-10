import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderStatus, OrderType, OrderSide, ExitProtectionStatus, SupervisedExecutionRequest, SupervisedExecutionResult, ProposalStatus } from '@trading-bot/contracts';
import { validateGTTExitParameters, calculateOptionCharges, isMarketOpenForTrading, isCalendarVerifiedForDate } from '@trading-bot/domain';
import { EnvService } from '../config/env.service';
import { ProposalsService } from '../proposals/proposals.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter, BrokerRequestError } from '../broker/upstox-broker.adapter';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { GoLiveChecklistService } from './go-live-checklist.service';
import { EventsGateway } from '../websocket/events.gateway';
import { BrokerRouterService } from '../broker/broker-router.service';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';
import { ConfirmedOrderFill, OrderAcknowledgement } from '../broker/broker.port';

@Injectable()
export class SupervisedExecutionService {
  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker: UpstoxBrokerAdapter,
    @Inject(UpstoxMarketFeedService) private readonly marketFeed: UpstoxMarketFeedService,
    @Inject(RiskReservationManager) private readonly riskReservationManager: RiskReservationManager,
    @Inject(GoLiveChecklistService) private readonly goLiveChecklist: GoLiveChecklistService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
    @Optional() @Inject(LiveExecutionLedgerService) private readonly ledger?: LiveExecutionLedgerService,
  ) {}
  public async executeSupervisedProposal(req: SupervisedExecutionRequest): Promise<SupervisedExecutionResult> {
    const proposal = this.proposalsService.getProposal(req.proposalId);
    if (!proposal) throw new NotFoundException(`Trade proposal '${req.proposalId}' not found.`);
    const live = this.router?.isLive() ?? false;
    const modeRevision = this.router?.getModeRevision();
    const approvedSnapshot = JSON.stringify(proposal);
    const broker = live ? this.upstoxBroker : this.paperBroker;
    if (live && (!this.envService.config.LIVE_EXECUTION_ENABLED || !this.ledger || !this.goLiveChecklist.getChecklist().liveExecutionPermitted)) throw new BadRequestException('Live execution requires the enabled feature flag, durable ledger and verified owner checklist.');
    if (live && (!isCalendarVerifiedForDate() || !isMarketOpenForTrading())) throw new BadRequestException('Live entry requires the verified exchange calendar and an open regular trading session.');
    if (live && [req.simulateTimeout, req.simulateProtectionFailure, req.simulateUncoveredPosition, req.simulateExitLimitUnfilled].some(Boolean)) throw new BadRequestException('Simulation controls cannot be used in Live mode.');
    if (proposal.status !== ProposalStatus.APPROVED) throw new BadRequestException(`Proposal '${req.proposalId}' must be APPROVED by owner before supervised execution. Current status: ${proposal.status}`);
    if (!Number.isFinite(Date.parse(proposal.expiresAt)) || Date.now() >= Date.parse(proposal.expiresAt)) throw new BadRequestException('Proposal approval window has expired. A fresh proposal and approval are required.');
    if (proposal.side !== OrderSide.BUY) throw new BadRequestException('Only long-option BUY proposals can enter through this supervised workflow.');
    // Freshness is mandatory. A missing quote cannot authorize execution.
    const quote = this.marketFeed.getQuote(proposal.instrumentKey);
    const age = quote ? Date.now() - Date.parse(quote.timestamp) : NaN;
    if (!quote || quote.isStale || !Number.isFinite(age) || age < -1000 || age > 3000 || !Number.isFinite(quote.bidPrice) || quote.bidPrice <= 0 || !Number.isFinite(quote.askPrice) || quote.askPrice < quote.bidPrice) throw new BadRequestException('Pre-trade revalidation failed: missing quote or quote age exceeds 3,000ms safety threshold.');
    if (live && (quote.provenance !== 'LIVE' || quote.depthKnown !== true || !(quote.bidQty > 0) || !(quote.askQty > 0))) throw new BadRequestException('Live execution requires genuine fresh broker depth and positive executable bid/ask quantities.');
    const spread = (quote.askPrice - quote.bidPrice) / quote.askPrice * 100;
    if (spread > 1) throw new BadRequestException('Pre-trade revalidation failed: spread exceeds 1.0% maximum liquidity ceiling.');
    const maximumPrice = Math.max(proposal.suggestedEntryPrice, quote.askPrice + (live ? 0 : 0.25));
    const capital = Math.max(proposal.estimatedCapitalRequired, maximumPrice * proposal.quantity);
    const charges = calculateOptionCharges({ buyPrice: maximumPrice, sellPrice: Math.max(1, proposal.suggestedStopPrice - 0.25), quantity: proposal.quantity }).totalRoundTripCharges;
    const risk = Math.max(proposal.allInMaxLoss, (maximumPrice - proposal.suggestedStopPrice + 0.25) * proposal.quantity + charges + 10);
    const assertEntryBoundary = (): void => {
      if (this.router && (this.router.isLive() !== live || this.router.getModeRevision() !== modeRevision)) throw new BadRequestException('Trading mode changed during proposal revalidation; a new owner approval is required.');
      const current = this.proposalsService.getProposal(proposal.id);
      if (!current || current.status !== ProposalStatus.APPROVED || JSON.stringify(current) !== approvedSnapshot || !Number.isFinite(Date.parse(current.expiresAt)) || Date.parse(current.expiresAt) <= Date.now()) throw new BadRequestException('Proposal approval changed or expired during entry revalidation.');
      this.riskReservationManager.assertEntryAllowed();
      if (live && (!this.envService.config.LIVE_EXECUTION_ENABLED || !this.goLiveChecklist.getChecklist().liveExecutionPermitted || !isCalendarVerifiedForDate() || !isMarketOpenForTrading())) throw new BadRequestException('Live checklist, execution consent or trading session changed before dispatch.');
      const currentQuote = this.marketFeed.getQuote(proposal.instrumentKey);
      const currentAge = currentQuote ? Date.now() - Date.parse(currentQuote.timestamp) : NaN;
      if (!currentQuote || currentQuote.isStale || !Number.isFinite(currentAge) || currentAge < -1000 || currentAge > 3000 || !Number.isFinite(currentQuote.bidPrice) || currentQuote.bidPrice <= 0 || !Number.isFinite(currentQuote.askPrice) || currentQuote.askPrice < currentQuote.bidPrice || currentQuote.askPrice > maximumPrice ||
        (currentQuote.askPrice - currentQuote.bidPrice) / currentQuote.askPrice * 100 > 1 ||
        (live && (currentQuote.provenance !== 'LIVE' || currentQuote.depthKnown !== true || !(currentQuote.bidQty > 0) || !(currentQuote.askQty > 0)))) throw new BadRequestException('Fresh executable quote or reserved entry price changed before dispatch.');
    };
    if (live) {
      const instrument = await broker.getInstrument(proposal.instrumentKey);
      assertEntryBoundary();
      if (!instrument || !/^NSE_FO\|\d+$/.test(instrument.instrumentKey) || proposal.quantity % instrument.lotSize !== 0) throw new BadRequestException('Live orders require the broker instrument token and correct contract lot size.');
      const funds = await broker.getFunds();
      assertEntryBoundary();
      if (funds.source !== 'LIVE_BROKER' || funds.status !== 'VERIFIED' || capital + charges > funds.availableCash) throw new BadRequestException('Verified live funds do not cover entry capital and estimated charges.');
      this.riskReservationManager.synchronizeFunds(funds.availableCash);
    }
    const intentId = `supervised_${proposal.id}`;
    const signalKey = `${proposal.strategyId}:${proposal.instrumentKey}:5m:${proposal.id}`;
    assertEntryBoundary();
    if (live && this.ledger!.getIntent(intentId)) throw new BadRequestException('This proposal already has a durable live intent; reconcile its existing outcome instead of replaying it.');
    const reservation = this.riskReservationManager.acquireReservation({ proposalId: proposal.id, signalKey, instrumentKey: proposal.instrumentKey, capitalRequired: capital, allInRisk: risk });
    if (live && !this.ledger!.tryLockIntent(intentId)) { this.riskReservationManager.releaseReservation(reservation.id); throw new BadRequestException('The existing entry workflow is still being reconciled.'); }
    const result = (status: OrderStatus, protection: ExitProtectionStatus, quantity: number, price: number, message: string, orderId = intentId, gttOrderId?: string): SupervisedExecutionResult => ({ orderId, intentId, orderStatus: status, protectionStatus: protection, filledQuantity: quantity, averagePrice: price, message, ...(gttOrderId ? { gttOrderId } : {}) });
    if (req.simulateTimeout) {
      this.riskReservationManager.setKillSwitch(true);
      return result(OrderStatus.UNKNOWN_BROKER_STATE, ExitProtectionStatus.UNPROTECTED, 0, 0, 'Simulated request timeout: outcome unknown; reservation retained and entries frozen.');
    }
    let dispatched = false;
    let ack: OrderAcknowledgement | undefined;
    let confirmed: ConfirmedOrderFill | undefined;
    try {
      assertEntryBoundary();
      dispatched = true;
      ack = await broker.placeOrder({ intentId, proposalId: proposal.id, reservationId: reservation.id, signalKey, symbol: proposal.symbol,
        expectedModeRevision: modeRevision, beforeBuyDispatch: assertEntryBoundary,
        reservedCapital: capital, reservedRisk: risk, tag: intentId.slice(0, 20), instrumentKey: proposal.instrumentKey,
        side: proposal.side, orderType: OrderType.LIMIT, product: proposal.product, quantity: proposal.quantity, price: proposal.suggestedEntryPrice,
        stopLossPrice: proposal.suggestedStopPrice, targetPrice: proposal.suggestedTargetPrice, estimatedCharges: charges, maximumExecutionPrice: maximumPrice });
      if (ack.status === 'REJECTED') {
        this.riskReservationManager.releaseReservation(reservation.id, ack.message);
        return result(OrderStatus.REJECTED, ExitProtectionStatus.UNPROTECTED, 0, 0, ack.message, ack.orderId);
      }
      confirmed = this.router ? await this.router.confirmFill(ack, proposal.quantity) : await this.confirmPaperFill(ack, proposal.quantity);
      if (live && confirmed.filledQuantity > 0 && !confirmed.terminal) {
        // Cancel the remainder before attaching a stop sized for the confirmed partial fill.
        const orders = await broker.getOrders();
        for (const id of confirmed.orderIds) {
          const order = orders.find((item) => item.id === id);
          if (order && ![OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status)) await broker.cancelOrder(id);
        }
        confirmed = await this.upstoxBroker.confirmFill(ack, proposal.quantity);
      }
      if (confirmed.filledQuantity === 0 && confirmed.terminal) {
        this.riskReservationManager.releaseReservation(reservation.id, 'Broker confirmed terminal order with no fill.');
        return result(confirmed.status as OrderStatus, ExitProtectionStatus.UNPROTECTED, 0, 0, 'Broker confirmed no execution; capital released.', ack.orderId);
      }
      if (confirmed.filledQuantity === 0 || !confirmed.terminal) {
        this.riskReservationManager.setKillSwitch(true);
        return result(confirmed.status as OrderStatus, ExitProtectionStatus.UNPROTECTED, confirmed.filledQuantity, confirmed.averagePrice, 'Fill is pending or partial remainder is unresolved. Reservation retained; entries frozen for reconciliation.', ack.orderId);
      }
      const quantity = confirmed.filledQuantity; const price = confirmed.averagePrice;
      this.riskReservationManager.commitReservationToPosition(reservation.id, price * quantity);
      const validation = validateGTTExitParameters({ fillPrice: price, stopLossPrice: proposal.suggestedStopPrice, targetPrice: proposal.suggestedTargetPrice, quantity });
      if (!validation.isValid || req.simulateProtectionFailure || req.simulateUncoveredPosition || req.simulateExitLimitUnfilled) throw new Error(validation.error || (req.simulateProtectionFailure ? 'Protective exit placement failed in paper drill.' : req.simulateUncoveredPosition ? 'Uncovered position detected in paper drill.' : 'Exit limit unfilled in paper drill; Manual intervention required.'));
      const protection = await broker.placeProtectiveExit({ instrumentKey: proposal.instrumentKey, quantity, product: proposal.product, stopLossPrice: proposal.suggestedStopPrice, targetPrice: proposal.suggestedTargetPrice });
      if (!protection.success || !protection.gttOrderId || protection.confirmedQty !== quantity) throw new Error(protection.message || 'Protective exit quantity or identifier could not be confirmed.');
      this.gateway.broadcast('order.protected', { orderId: ack.orderId, intentId, gttOrderId: protection.gttOrderId, quantity, averagePrice: price });
      return result(quantity === proposal.quantity ? OrderStatus.PROTECTED : OrderStatus.PARTIALLY_FILLED, protection.protectionStatus, quantity, price,
        live ? `Confirmed ${quantity} units at ₹${price.toFixed(2)}. Broker stop verified; target is managed by the server. Trigger execution is not guaranteed.` : `Confirmed paper fill at ₹${price.toFixed(2)}, protected with GTT Stop and Target in simulation; not a guaranteed stop.`, ack.orderId, protection.gttOrderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed.';
      if (!dispatched || (error instanceof BrokerRequestError && error.definiteRejection && !ack && !confirmed?.filledQuantity)) {
        this.riskReservationManager.releaseReservation(reservation.id, message);
        throw new BadRequestException(`Supervised execution rejected: ${message}`);
      }
      this.riskReservationManager.setKillSwitch(true);
      const quantity = confirmed?.filledQuantity || 0;
      const status = quantity > 0 ? OrderStatus.PROTECTION_FAILED : OrderStatus.UNKNOWN_BROKER_STATE;
      if (live && this.ledger!.getIntent(intentId)) this.ledger!.update(intentId, { state: status, message });
      return result(status, quantity > 0 ? ExitProtectionStatus.PROTECTION_FAILED : ExitProtectionStatus.UNPROTECTED, quantity, confirmed?.averagePrice || 0,
        `${message} Account entries frozen. Position or ambiguous dispatch remains reserved; broker reconciliation is required.`, ack?.orderId || intentId);
    } finally { if (live) this.ledger!.unlockIntent(intentId); }
  }
  private async confirmPaperFill(ack: OrderAcknowledgement, quantity: number): Promise<ConfirmedOrderFill> {
    const order = (await this.paperBroker.getOrders()).find((item) => item.id === ack.orderId);
    return { status: order?.status || OrderStatus.UNKNOWN_BROKER_STATE, filledQuantity: order?.filledQuantity || 0, averagePrice: order?.averageFillPrice || 0,
      orderIds: [ack.orderId], complete: order?.filledQuantity === quantity && order.status === OrderStatus.FILLED,
      terminal: order !== undefined && [OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(order.status) };
  }
}
