import { Injectable, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { BrokerPort, OrderAcknowledgement } from './broker.port';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter, BrokerRequestError } from './upstox-broker.adapter';
import { TradingModeService } from '../trading/trading-mode.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { LiveExecutionLedgerService } from './live-execution-ledger.service';
import { OrderSide, OrderStatus } from '@trading-bot/contracts';

/** One server-owned mode selects data reads and order mutations consistently. */
@Injectable()
export class BrokerRouterService implements BrokerPort, OnApplicationBootstrap {
  constructor(
    @Inject(TradingModeService) private readonly mode: TradingModeService,
    @Inject(PaperBrokerAdapter) private readonly paper: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly live: UpstoxBrokerAdapter,
    @Inject(RiskReservationManager) private readonly risk: RiskReservationManager,
    @Inject(LiveExecutionLedgerService) private readonly ledger: LiveExecutionLedgerService,
  ) {}
  public onApplicationBootstrap(): void { if (this.isLive()) this.recoverLiveExposure(); }
  public isLive(): boolean { return this.mode.isLive(); }
  public getModeRevision(): number { return this.mode.getRevision(); }
  public getBroker(): PaperBrokerAdapter | UpstoxBrokerAdapter { return this.isLive() ? this.live : this.paper; }
  public getActiveAdapter(): PaperBrokerAdapter | UpstoxBrokerAdapter { return this.getBroker(); }
  public get brokerName(): string { return this.getBroker().brokerName; }
  public getConnectionHealth() { return this.getBroker().getConnectionHealth(); }
  public getFunds() { return this.getBroker().getFunds(); }
  public getMargin(key: string, quantity: number, price?: number) { return this.getBroker().getMargin(key, quantity, price); }
  public getInstrument(key: string) { return this.getBroker().getInstrument(key); }
  public getOrders() { return this.getBroker().getOrders(); }
  public getPositions() { return this.getBroker().getPositions(); }
  public getFills() { return this.getBroker().getFills(); }
  public async placeOrder(req: any): Promise<OrderAcknowledgement> {
    const live = this.isLive(); const revision = req.expectedModeRevision ?? this.mode.getRevision(); const broker = this.getBroker();
    if (req.side === OrderSide.BUY) {
      try {
        if (this.mode.getRevision() !== revision) throw new Error('Trading mode changed before entry funds verification. Refresh before submitting.');
        this.risk.assertEntryAllowed();
        if (live) {
          const funds = await this.live.getFunds();
          if (funds.source !== 'LIVE_BROKER' || funds.status !== 'VERIFIED') throw new Error('Verified live broker funds are required before a BUY.');
          if (!this.isLive() || this.mode.getRevision() !== revision) throw new Error('Trading mode changed during entry funds verification. Refresh before submitting.');
          this.risk.assertEntryAllowed();
          this.risk.synchronizeFunds(funds.availableCash);
        }
      } catch (error) {
        throw new BrokerRequestError(error instanceof Error ? error.message : 'Entry funds verification was revoked before dispatch.', true);
      }
    }
    return broker.placeOrder({ ...req, ...(req.side === OrderSide.BUY && live ? { expectedModeRevision: revision } : {}) });
  }
  public modifyOrder(req: any) { return this.getBroker().modifyOrder(req); }
  public cancelOrder(orderId: string) { return this.getBroker().cancelOrder(orderId); }
  public placeProtectiveExit(req: any) { return this.getBroker().placeProtectiveExit(req); }
  public async cancelProtectiveExit(gttOrderId: string): Promise<void> {
    if (this.isLive()) await this.live.cancelProtectiveExit(gttOrderId);
  }
  public async reconcileStopAfterFlat(gttOrderId: string, instrumentKey: string): Promise<void> { if (this.isLive()) await this.live.reconcileStopAfterFlat(gttOrderId, instrumentKey); }
  public async confirmFill(ack: OrderAcknowledgement, quantity: number) {
    if (this.isLive()) return this.live.confirmFill(ack, quantity);
    const order = (await this.paper.getOrders()).find((item) => item.id === ack.orderId);
    return { orderIds: [ack.orderId], status: order?.status || OrderStatus.UNKNOWN_BROKER_STATE,
      filledQuantity: order?.filledQuantity || 0, averagePrice: order?.averageFillPrice || 0,
      complete: order?.status === OrderStatus.FILLED && order.filledQuantity === quantity,
      terminal: order !== undefined && [OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status) };
  }
  /** Recover saved live accounting, then freeze until a successful full broker reconciliation. */
  public recoverLiveExposure(): void {
    const records = this.ledger.getEntries();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (this.risk.getActiveReservations().length === 0) this.risk.restoreDailyResults(today, records.filter((intent) => intent.side === OrderSide.BUY && intent.state === OrderStatus.CLOSED && intent.settledPnl !== undefined && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(intent.updatedAt)) === today).map((intent) => ({ orderId: intent.intentId, realizedNetPnl: intent.settledPnl! })));
    if (!this.ledger.hasUnresolvedExposure()) return;
    this.risk.setKillSwitch(true);
    const open = records.filter((intent) => intent.side === OrderSide.BUY && intent.filledQuantity > 0 && intent.state !== OrderStatus.CLOSED);
    if (open.length !== 1) return;
    const entry = open[0]!;
    if (!entry.reservationId || !entry.signalKey || entry.reservedRisk <= 0) return;
    const existing = this.risk.getReservation(entry.reservationId);
    if (existing) {
      if (existing.instrumentKey !== entry.instrumentKey || existing.status !== 'COMMITTED' || Math.abs(existing.reservedCapital - entry.averagePrice * entry.filledQuantity) > 0.01) this.risk.setKillSwitch(true);
      return;
    }
    this.risk.restoreConfirmedPosition({ id: entry.reservationId, proposalId: entry.proposalId || entry.intentId, signalKey: entry.signalKey,
      instrumentKey: entry.instrumentKey, reservedCapital: entry.averagePrice * entry.filledQuantity, reservedRisk: entry.reservedRisk, status: 'COMMITTED', createdAt: entry.createdAt });
  }
}
