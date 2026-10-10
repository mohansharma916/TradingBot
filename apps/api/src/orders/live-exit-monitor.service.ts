import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BrokerRouterService } from '../broker/broker-router.service';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';
import { OrdersService } from './orders.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { OrderSide, OrderStatus } from '@trading-bot/contracts';
import { EventsGateway } from '../websocket/events.gateway';

/** Runs independently of the UI; the broker stop stays active until a confirmed cancellation precedes an exit. */
@Injectable()
export class LiveExitMonitorService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private working = false;
  constructor(@Inject(BrokerRouterService) private readonly router: BrokerRouterService,
    @Inject(LiveExecutionLedgerService) private readonly ledger: LiveExecutionLedgerService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(RiskReservationManager) private readonly risk: RiskReservationManager,
    @Inject(EventsGateway) private readonly gateway: EventsGateway) {}
  onModuleInit(): void { this.timer = setInterval(() => { void this.tick(); }, 1000); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  public async tick(): Promise<void> {
    if (this.working) return;
    if (!this.router.isLive()) { await this.monitorPaper(); return; }
    if (!this.ledger.hasUnresolvedExposure()) return;
    this.working = true;
    try {
      const brokerPositions = await this.router.getPositions();
      await this.router.getOrders();
      for (const entry of this.ledger.getEntries().filter((intent) => intent.side === OrderSide.BUY && intent.filledQuantity > 0 && intent.state !== OrderStatus.CLOSED)) {
        const position = brokerPositions.find((item) => item.instrumentKey === entry.instrumentKey && item.netQuantity > 0);
        if (!position) { await this.orders.closePosition(entry.instrumentKey); continue; }
        if (position.netQuantity !== entry.filledQuantity) { this.risk.setKillSwitch(true); continue; }
        const quote = this.feed.getQuote(entry.instrumentKey); const age = quote ? Date.now() - Date.parse(quote.timestamp) : NaN;
        const fresh = quote && quote.provenance === 'LIVE' && quote.depthKnown === true && !quote.isStale && age >= -1000 && age <= 3000 && quote.bidPrice > 0 && quote.bidQty > 0;
        const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
        const priorTradingDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(entry.createdAt)) !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        if (clock >= '15:15' || priorTradingDay || (fresh && ((entry.targetPrice !== undefined && quote.bidPrice >= entry.targetPrice) || (entry.stopLossPrice !== undefined && quote.bidPrice <= entry.stopLossPrice)))) await this.orders.closePosition(entry.instrumentKey);
      }
    } catch (error) {
      this.risk.setKillSwitch(true);
      this.gateway.broadcast('live.monitor_error', { message: error instanceof Error ? error.message : 'Live exposure monitoring failed; entries frozen.' });
    } finally { this.working = false; }
  }
  private async monitorPaper(): Promise<void> {
    this.working = true;
    try {
      const positions = await this.router.getPositions();
      for (const position of positions) {
        if (!this.risk.getActiveReservations().some((record) => record.instrumentKey === position.instrumentKey && record.status === 'COMMITTED')) continue;
        const quote = this.feed.getQuote(position.instrumentKey); const age = quote ? Date.now() - Date.parse(quote.timestamp) : NaN;
        if (!quote || quote.isStale || !Number.isFinite(age) || age < -1000 || age > 3000 || quote.bidPrice <= 0) continue;
        if ((position.stopLossPrice != null && quote.bidPrice <= position.stopLossPrice) || (position.targetPrice != null && quote.bidPrice >= position.targetPrice)) await this.orders.closePosition(position.instrumentKey);
      }
    } catch (error) { this.risk.setKillSwitch(true); this.gateway.broadcast('paper.monitor_error', { message: error instanceof Error ? error.message : 'Paper protection monitoring failed.' }); }
    finally { this.working = false; }
  }
}
