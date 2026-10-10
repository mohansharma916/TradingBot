import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { BrokerOrder, OrderSide, OrderStatus, OrderType, Position, ProductType, ProposalStatus } from '@trading-bot/contracts';
import { randomUUID } from 'node:crypto';
import { calculateOptionCharges } from '@trading-bot/domain';
import { PaperBrokerAdapter, OrderFillEvent } from '../broker/paper-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { ProposalsService } from '../proposals/proposals.service';
import { EventsGateway } from '../websocket/events.gateway';
import { BrokerRouterService } from '../broker/broker-router.service';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';

export interface OwnedExitResult { success: boolean; message: string; orderId?: string; quantity?: number; exitPrice?: number; netPnl?: number; charges?: number; status?: OrderStatus; }

@Injectable()
export class OrdersService {
  private readonly closing = new Set<string>();
  constructor(
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(RiskReservationManager) private readonly reservationManager: RiskReservationManager,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
    @Optional() @Inject(LiveExecutionLedgerService) private readonly ledger?: LiveExecutionLedgerService,
  ) {}
  public async getOrders(): Promise<BrokerOrder[]> { return this.router ? this.router.getOrders() : this.paperBroker.getOrders(); }
  public async getPositions(): Promise<Position[]> { return this.router ? this.router.getPositions() : this.paperBroker.getPositions(); }
  public getFills(): OrderFillEvent[] { return this.router ? this.router.getFills() : this.paperBroker.getFills(); }
  public async executeApprovedProposal(proposalId: string, options: { simulatedPartialFill?: boolean } = {}): Promise<{ orderId: string; status: OrderStatus; message: string }> {
    if (this.router?.isLive()) throw new BadRequestException('Live entries require the supervised execution workflow with verified fills and broker protection.');
    const proposal = this.proposalsService.getProposal(proposalId);
    if (!proposal) throw new NotFoundException(`Proposal '${proposalId}' not found.`);
    if (proposal.status !== ProposalStatus.APPROVED || !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now()) throw new BadRequestException('A current explicitly approved proposal is required.');
    const signalKey = `${proposal.strategyId}:${proposal.instrumentKey}:${proposal.id}`;
    const reservation = this.reservationManager.acquireReservation({ proposalId: proposal.id, signalKey, instrumentKey: proposal.instrumentKey, capitalRequired: proposal.estimatedCapitalRequired, allInRisk: proposal.allInMaxLoss });
    try {
      const ack = await this.paperBroker.placeOrder({ intentId: reservation.id, tag: `SIG_${proposal.strategyVersion}`, instrumentKey: proposal.instrumentKey, side: proposal.side,
        orderType: OrderType.LIMIT, product: proposal.product, quantity: proposal.quantity, price: proposal.suggestedEntryPrice, stopLossPrice: proposal.suggestedStopPrice,
        targetPrice: proposal.suggestedTargetPrice, estimatedCharges: proposal.estimatedRoundTripCosts, simulatedPartialFill: options.simulatedPartialFill });
      if (ack.status === 'REJECTED') { this.reservationManager.releaseReservation(reservation.id, ack.message); return { orderId: ack.orderId, status: OrderStatus.REJECTED, message: ack.message }; }
      const order = (await this.paperBroker.getOrders()).find((item) => item.id === ack.orderId);
      if (!order || order.filledQuantity <= 0 || order.averageFillPrice <= 0) { this.reservationManager.setKillSwitch(true); return { orderId: ack.orderId, status: OrderStatus.UNKNOWN_BROKER_STATE, message: 'Paper fill could not be confirmed. Risk retained.' }; }
      this.reservationManager.commitReservationToPosition(reservation.id, order.filledQuantity * order.averageFillPrice);
      this.gateway.broadcast('order.executed', { orderId: ack.orderId, status: order.status });
      return { orderId: ack.orderId, status: order.status, message: `Confirmed paper fill: ${order.filledQuantity} units at ₹${order.averageFillPrice}.` };
    } catch (error) {
      if (!this.paperBroker.getFills().some((fill) => fill.instrumentKey === proposal.instrumentKey && fill.side === OrderSide.BUY)) this.reservationManager.releaseReservation(reservation.id);
      else this.reservationManager.setKillSwitch(true);
      throw error;
    }
  }
  public async closePosition(instrumentKey: string): Promise<OwnedExitResult> {
    if (this.closing.has(instrumentKey)) return { success: false, message: 'An owned exit is already being reconciled.' };
    this.closing.add(instrumentKey);
    try {
      const live = this.router?.isLive() ?? false;
      const broker = this.router?.getBroker() || this.paperBroker;
      let position = (await broker.getPositions()).find((item) => item.instrumentKey === instrumentKey && item.netQuantity > 0);
      const entry = live ? this.ledger?.getEntryForInstrument(instrumentKey) : undefined;
      if (live && entry?.protectionDispatchPending && !entry.gttOrderId) throw new BadRequestException('Protective stop dispatch has an unknown broker outcome. No competing SELL or risk release is permitted until the stop is reconciled.');
      if (!position) {
        if (entry) return await this.settleObservedExitIfFlat(instrumentKey);
        throw new NotFoundException(`No open position found for instrument '${instrumentKey}'.`);
      }
      const existingExit = live && entry ? this.ledger!.getEntries().find((intent) => intent.side === OrderSide.SELL && intent.entryIntentId === entry.intentId && ![OrderStatus.CLOSED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(intent.state)) : undefined;
      if (live && (!entry || !entry.reservationId || entry.filledQuantity - (existingExit?.filledQuantity || 0) !== position.netQuantity)) throw new BadRequestException('Live exit requires reconciled owned quantity and a durable reservation. External or partial exposure needs manual review.');
      if (live && entry?.gttOrderId) {
        await this.router!.cancelProtectiveExit(entry.gttOrderId);
        position = (await broker.getPositions()).find((item) => item.instrumentKey === instrumentKey && item.netQuantity > 0);
        if (!position || position.netQuantity !== entry.filledQuantity) { this.reservationManager.setKillSwitch(true); return { success: false, message: 'Exposure changed during stop cancellation; no competing SELL was submitted.' }; }
      }
      const intentId = existingExit?.intentId || `exit_${randomUUID()}`;
      const exitQuantity = existingExit?.quantity || position.netQuantity;
      const ack = existingExit
        ? { orderId: existingExit.orderIds[0] || existingExit.intentId, orderIds: existingExit.orderIds, tag: 'EXIT_OWNED', status: 'ACKNOWLEDGED', message: 'Reconciling existing exit.' }
        : await broker.placeOrder({ intentId, entryIntentId: entry?.intentId, reservationId: entry?.reservationId, tag: 'EXIT_OWNED', instrumentKey, side: OrderSide.SELL,
          orderType: OrderType.MARKET, product: entry?.product || ProductType.I, quantity: position.netQuantity, reservedCapital: 0, reservedRisk: 0 });
      if (ack.status === 'REJECTED') { this.reservationManager.setKillSwitch(true); return { success: false, orderId: ack.orderId, quantity: exitQuantity, status: OrderStatus.REJECTED, message: `Exit rejected: ${ack.message}. Position risk remains reserved; exit intervention is required.` }; }
      const confirmed = this.router ? await this.router.confirmFill(ack, exitQuantity) : undefined;
      const paperExit = !live ? this.paperBroker.getConfirmedExit(ack.orderId, position.buyAvgPrice, position.netQuantity) : undefined;
      const remaining = (await broker.getPositions()).find((item) => item.instrumentKey === instrumentKey && item.netQuantity !== 0);
      if (remaining || (live ? !confirmed?.complete : !paperExit)) { this.reservationManager.setKillSwitch(true); return { success: false, orderId: ack.orderId, quantity: position.netQuantity, status: confirmed?.status as OrderStatus || OrderStatus.ACKNOWLEDGED, message: 'Exit is pending, rejected, partial, or not verified flat. Risk remains reserved; no duplicate SELL will be submitted.' }; }
      const price = live ? confirmed!.averagePrice : paperExit!.exitPrice;
      const entryPrice = live ? entry!.averagePrice : position.buyAvgPrice;
      const pnl = live ? Number(((price - entryPrice) * exitQuantity - calculateOptionCharges({ buyPrice: entryPrice, sellPrice: price, quantity: exitQuantity }).totalRoundTripCharges).toFixed(2)) : paperExit!.netPnl;
      const reservation = entry?.reservationId ? this.reservationManager.getReservation(entry.reservationId) : this.reservationManager.getActiveReservations().find((record) => record.instrumentKey === instrumentKey);
      if (!reservation || !this.reservationManager.settleReservation(reservation.id, pnl)) return { success: false, message: 'Broker exit filled, but reservation settlement requires review.' };
      if (live) this.ledger!.settleExit(intentId, pnl);
      this.gateway.broadcast('position.closed', { instrumentKey, orderId: ack.orderId, price, netPnl: pnl, chargesSource: live ? 'ESTIMATED' : 'SIMULATED' });
      return { success: true, orderId: ack.orderId, quantity: exitQuantity, exitPrice: price, netPnl: pnl,
        charges: live ? calculateOptionCharges({ buyPrice: entryPrice, sellPrice: price, quantity: exitQuantity }).totalRoundTripCharges : paperExit!.charges,
        status: OrderStatus.CLOSED, message: `Broker-confirmed complete exit and flat position: ${ack.orderId}.${live ? ' Net P&L uses estimated charges until the contract note is available.' : ''}` };
    } catch (error) {
      if (this.router?.isLive()) this.reservationManager.setKillSwitch(true);
      throw error;
    } finally { this.closing.delete(instrumentKey); }
  }
  /** Settle a broker-triggered/manual exit only when one complete SELL and a flat broker position agree. */
  public async reconcileExternalExitIfFlat(instrumentKey: string): Promise<OwnedExitResult> {
    if (this.closing.has(instrumentKey)) return { success: false, message: 'An owned exit is already being reconciled.' };
    this.closing.add(instrumentKey);
    try { return await this.settleObservedExitIfFlat(instrumentKey); }
    catch (error) { this.reservationManager.setKillSwitch(true); throw error; }
    finally { this.closing.delete(instrumentKey); }
  }
  private async settleObservedExitIfFlat(instrumentKey: string): Promise<OwnedExitResult> {
    if (!this.router?.isLive() || !this.ledger) return { success: false, message: 'No live ledger is selected.' };
    const entry = this.ledger.getEntryForInstrument(instrumentKey);
    if (!entry || !entry.reservationId) return { success: false, message: 'No owned live entry is available for settlement.' };
    if (entry.protectionDispatchPending && !entry.gttOrderId) throw new BadRequestException('Protective stop dispatch remains unknown; flat exposure alone cannot resolve a possible outstanding SELL trigger.');
    const positions = await this.router.getPositions();
    if (positions.some((position) => position.instrumentKey === instrumentKey && position.netQuantity !== 0)) return { success: false, message: 'Broker exposure remains open.' };
    const orders = await this.router.getOrders();
    if (orders.some((order) => order.instrumentKey === instrumentKey && order.side === OrderSide.SELL && ![OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status))) {
      this.reservationManager.setKillSwitch(true); return { success: false, message: 'Broker is flat but another SELL remains active. Risk stays reserved until its outcome is confirmed.' };
    }
    const consumed = new Set(this.ledger.getEntries().filter((intent) => intent.side === OrderSide.SELL && intent.entryIntentId !== entry.intentId).flatMap((intent) => intent.orderIds));
    const known = this.ledger.getEntries().find((intent) => intent.side === OrderSide.SELL && intent.entryIntentId === entry.intentId && intent.filledQuantity === entry.filledQuantity && intent.orderIds.length > 0 &&
      intent.orderIds.every((id) => orders.some((order) => order.id === id && order.instrumentKey === instrumentKey && order.side === OrderSide.SELL &&
        [OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status) && !consumed.has(id))));
    const exits = known ? [] : orders.filter((order) => order.instrumentKey === instrumentKey && order.side === OrderSide.SELL && order.status === OrderStatus.FILLED &&
      order.filledQuantity === entry.filledQuantity && order.averageFillPrice > 0 && Date.parse(order.createdAt) >= Date.parse(entry.createdAt) && !consumed.has(order.id));
    if (!known && exits.length !== 1) { this.reservationManager.setKillSwitch(true); return { success: false, message: 'Broker is flat but its complete exit fill cannot be uniquely matched. Risk remains reserved for manual reconciliation.' }; }
    const orderId = known?.orderIds[0] || exits[0]!.id;
    const exitPrice = known?.averagePrice || exits[0]!.averageFillPrice;
    const intentId = known?.intentId || `${entry.intentId}:observed:${orderId}`;
    if (entry.gttOrderId) await this.router.reconcileStopAfterFlat(entry.gttOrderId, instrumentKey);
    if ((await this.router.getPositions()).some((position) => position.instrumentKey === instrumentKey && position.netQuantity !== 0)) throw new Error('Broker exposure changed during exit reconciliation; settlement remains frozen.');
    if (!this.ledger.getIntent(intentId)) {
      this.ledger.beginIntent({ intentId, instrumentKey, side: OrderSide.SELL, product: entry.product, quantity: entry.filledQuantity, entryIntentId: entry.intentId, reservedCapital: 0, reservedRisk: 0 });
      this.ledger.markAcknowledged(intentId, [orderId]);
    }
    this.ledger.observeOrders(orders);
    const charges = calculateOptionCharges({ buyPrice: entry.averagePrice, sellPrice: exitPrice, quantity: entry.filledQuantity }).totalRoundTripCharges;
    const pnl = Number(((exitPrice - entry.averagePrice) * entry.filledQuantity - charges).toFixed(2));
    if (!this.reservationManager.settleReservation(entry.reservationId, pnl)) return { success: false, message: 'Confirmed flat broker exposure still requires reservation settlement review.' };
    this.ledger.settleExit(intentId, pnl);
    this.gateway.broadcast('position.closed', { instrumentKey, orderId, price: exitPrice, netPnl: pnl, chargesSource: 'ESTIMATED' });
    return { success: true, orderId, quantity: entry.filledQuantity, exitPrice, netPnl: pnl, charges, status: OrderStatus.CLOSED, message: 'A complete owned broker SELL and flat position were reconciled. Charges remain estimated.' };
  }
}
