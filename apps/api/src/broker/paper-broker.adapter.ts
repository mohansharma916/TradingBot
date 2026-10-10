import { Injectable, Inject, Logger } from '@nestjs/common';
import { BrokerPort, FundsSnapshot, MarginEstimate, OrderAcknowledgement } from './broker.port';
import {
  BrokerHealth,
  BrokerHealthStatus,
  BrokerOrder,
  Instrument,
  Position,
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
  QuoteSnapshot,
  ExitProtectionStatus,
  ProtectionResult,
  DailyBotTrade,
} from '@trading-bot/contracts';
import { calculateOptionCharges, ChargeBreakdown } from '@trading-bot/domain';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { EventsGateway } from '../websocket/events.gateway';

export interface OrderFillEvent {
  id: string;
  orderId: string;
  instrumentKey: string;
  side: OrderSide;
  fillQty: number;
  fillPrice: number;
  charges: ChargeBreakdown;
  timestamp: string;
  estimatedCharges: number;
  actualCharges: number;
}

export interface PlacePaperOrderParams {
  intentId: string;
  tag: string;
  instrumentKey: string;
  side: OrderSide;
  orderType: OrderType;
  product: ProductType;
  quantity: number;
  price?: number;
  triggerPrice?: number;
  stopLossPrice?: number;
  targetPrice?: number;
  estimatedCharges?: number;
  simulatedPartialFill?: boolean;
  maximumExecutionPrice?: number;
  disableTarget?: boolean;
}

/**
 * PaperBrokerAdapter
 * High-fidelity Indian F&O options paper trading simulation engine.
 * 
 * Strict Invariants:
 * 1. Stale Quote Gate: If feed quote is missing or stale (>3,000ms), order submission is rejected.
 * 2. Realistic Slippage & Charges: Exact exchange STT/GST/SEBI/stamp duty calculated per fill.
 * 3. Partial Fills: Supports execution of partial fills with updated average price and state.
 * 4. Transparent Accounting: Distinguishes estimated round-trip costs vs verified actual fees.
 */
@Injectable()
export class PaperBrokerAdapter implements BrokerPort {
  public readonly brokerName = 'PAPER_SIMULATION';
  private readonly logger = new Logger(PaperBrokerAdapter.name);

  private orders: Map<string, BrokerOrder> = new Map();
  private positions: Map<string, Position> = new Map();
  private fills: OrderFillEvent[] = [];

  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  async getConnectionHealth(): Promise<BrokerHealth> {
    const feedHealth = this.feed.getFeedHealth();
    return {
      broker: 'UPSTOX',
      status: feedHealth.staleCount > 0 ? BrokerHealthStatus.DEGRADED : BrokerHealthStatus.HEALTHY,
      isAuthenticated: true,
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      registeredEgressIp: '127.0.0.1',
      currentEgressIp: '127.0.0.1',
      ipMatches: true,
      marketFeedConnected: true,
      feedLatencyMs: feedHealth.feedLatencyMs,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getFunds(): Promise<FundsSnapshot> {
    return {
      currency: 'INR',
      availableCash: 10000.0,
      usedMargin: 0.0,
      totalCollateral: 10000.0,
      payinAmount: 0.0,
      spanMargin: 0.0,
      exposureMargin: 0.0,
    };
  }

  async getMargin(_instrumentKey: string, quantity: number, price = 100): Promise<MarginEstimate> {
    const required = quantity * price;
    return {
      requiredMargin: required,
      finalMargin: required,
      shortfall: 0,
    };
  }

  async getInstrument(key: string): Promise<Instrument | undefined> {
    return this.catalog.getInstrument(key);
  }

  async getOrders(): Promise<BrokerOrder[]> {
    return Array.from(this.orders.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values()).map((position) => ({ ...position }));
  }

  public getFills(): OrderFillEvent[] {
    return [...this.fills];
  }

  public getConfirmedExit(orderId: string, buyPrice: number, quantity: number): { exitPrice: number; charges: number; netPnl: number } | undefined {
    const exits = this.fills.filter((fill) => fill.orderId === orderId && fill.side === OrderSide.SELL);
    if (exits.reduce((sum, fill) => sum + fill.fillQty, 0) !== quantity) return undefined;
    let remaining = quantity;
    let entryCharges = 0;
    for (const buy of this.fills.filter((fill) => fill.instrumentKey === exits[0]!.instrumentKey && fill.side === OrderSide.BUY)) {
      const included = Math.min(remaining, buy.fillQty);
      entryCharges += buy.actualCharges * included / buy.fillQty;
      remaining -= included;
      if (remaining === 0) break;
    }
    const exitPrice = exits.reduce((sum, fill) => sum + fill.fillPrice * fill.fillQty, 0) / quantity;
    const charges = Number((entryCharges + exits.reduce((sum, fill) => sum + fill.actualCharges, 0)).toFixed(2));
    return { exitPrice, charges, netPnl: Number(((exitPrice - buyPrice) * quantity - charges).toFixed(2)) };
  }

  /** Rehydrate only a durably confirmed simulator entry; never fabricate an unresolved fill. */
  public restoreConfirmedPosition(trade: DailyBotTrade): void {
    if (this.positions.size || this.orders.has(trade.orderId) || !trade.reservationId || !trade.openedAt || trade.entryActualCharges === undefined || trade.status !== 'OPEN') throw new Error('Confirmed paper position cannot be restored from incomplete or conflicting metadata.');
    this.positions.set(trade.instrumentKey, { id: `restored_${trade.orderId}`, instrumentKey: trade.instrumentKey, symbol: trade.symbol, netQuantity: trade.quantity, buyQuantity: trade.quantity, sellQuantity: 0, buyAvgPrice: trade.entryPrice, sellAvgPrice: 0, lastPrice: trade.currentPrice, unrealizedPnl: trade.grossPnl ?? 0, realizedPnl: 0, stopLossPrice: trade.stopPrice, targetPrice: null, lastVerifiedAt: trade.openedAt });
    this.orders.set(trade.orderId, { id: trade.orderId, intentId: trade.reservationId, brokerOrderId: trade.orderId, tag: 'RESTORED_DAILY_ENTRY', instrumentKey: trade.instrumentKey, side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: trade.quantity, price: trade.entryPrice, status: OrderStatus.FILLED, filledQuantity: trade.quantity, averageFillPrice: trade.entryPrice, createdAt: trade.openedAt, updatedAt: trade.openedAt });
    const charges = calculateOptionCharges({ buyPrice: trade.entryPrice, sellPrice: 0, quantity: trade.quantity });
    charges.brokerage = 20;
    charges.gst = Number((charges.gst - 3.6).toFixed(2));
    charges.totalRoundTripCharges = trade.entryActualCharges;
    this.fills.unshift({ id: `restored_fill_${trade.orderId}`, orderId: trade.orderId, instrumentKey: trade.instrumentKey, side: OrderSide.BUY, fillQty: trade.quantity, fillPrice: trade.entryPrice, timestamp: trade.openedAt, estimatedCharges: trade.estimatedCharges, actualCharges: trade.entryActualCharges, charges });
  }

  /**
   * Places and simulates execution of a paper order.
   */
  async placeOrder(params: PlacePaperOrderParams): Promise<OrderAcknowledgement> {
    const previous = Array.from(this.orders.values()).find((order) => order.intentId === params.intentId);
    if (previous) {
      return { orderId: previous.id, tag: previous.tag, status: previous.status === OrderStatus.REJECTED ? 'REJECTED' : 'ACKNOWLEDGED', message: 'Existing paper order returned for this intent.' };
    }
    const orderId = `ord_paper_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
      return { orderId, tag: params.tag, status: 'REJECTED', message: 'Quantity must be a positive integer.' };
    }
    if (params.side === OrderSide.SELL && params.quantity > (this.positions.get(params.instrumentKey)?.netQuantity ?? 0)) {
      return { orderId, tag: params.tag, status: 'REJECTED', message: 'Exit quantity exceeds the confirmed open position.' };
    }

    // 1. Stale Feed Gate Check
    const quote = this.feed.getQuote(params.instrumentKey);
    const isQuoteStale = this.checkIfQuoteStale(quote);

    if (isQuoteStale) {
      const rejectedOrder: BrokerOrder = {
        id: orderId,
        intentId: params.intentId,
        brokerOrderId: null,
        tag: params.tag,
        instrumentKey: params.instrumentKey,
        side: params.side,
        orderType: params.orderType,
        product: params.product,
        quantity: params.quantity,
        price: params.price,
        status: OrderStatus.REJECTED,
        filledQuantity: 0,
        averageFillPrice: 0,
        rejectionReason: 'REJECTED_STALE_FEED: Market feed is stale or disconnected. Safety invariant halted order execution.',
        createdAt: now,
        updatedAt: now,
      };

      this.orders.set(orderId, rejectedOrder);
      this.gateway.broadcast('order.changed', rejectedOrder);
      this.logger.warn(`[PaperBroker] Order ${orderId} REJECTED due to stale feed.`);

      return {
        orderId,
        tag: params.tag,
        status: 'REJECTED',
        message: 'Order rejected by stale feed safety check.',
      };
    }

    // 2. Realistic Price & Slippage Simulation
    const basePrice = quote ? (params.side === OrderSide.BUY ? quote.askPrice : quote.bidPrice) : (params.price || 120.0);
    const slippage = params.side === OrderSide.BUY ? 0.25 : -0.25;
    const executionPrice = Number(Math.max(1.0, basePrice + slippage).toFixed(2));
    if (params.maximumExecutionPrice !== undefined && executionPrice > params.maximumExecutionPrice) {
      return { orderId, tag: params.tag, status: 'REJECTED', message: 'Executable ask moved above the reserved entry price; refresh and revalidate the signal.' };
    }

    // 3. Partial Fill or Full Fill Decision
    const isPartial = params.simulatedPartialFill && params.quantity > 25;
    const filledQuantity = isPartial ? Math.floor(params.quantity / 2) : params.quantity;
    const finalStatus = isPartial ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED;

    const brokerOrder: BrokerOrder = {
      id: orderId,
      intentId: params.intentId,
      brokerOrderId: `PAPER_${Date.now()}`,
      tag: params.tag,
      instrumentKey: params.instrumentKey,
      side: params.side,
      orderType: params.orderType,
      product: params.product,
      quantity: params.quantity,
      price: params.price || executionPrice,
      status: finalStatus,
      filledQuantity,
      averageFillPrice: executionPrice,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(orderId, brokerOrder);

    // 4. Calculate Verified Actual Statutory Charges
    const charges = calculateOptionCharges({
      buyPrice: params.side === OrderSide.BUY ? executionPrice : 0,
      sellPrice: params.side === OrderSide.SELL ? executionPrice : 0,
      quantity: filledQuantity,
    });
    // A fill executes one leg. Remove the calculator's second brokerage leg and its GST.
    charges.brokerage = 20;
    charges.gst = Number((charges.gst - 3.6).toFixed(2));
    charges.totalRoundTripCharges = Number((charges.totalRoundTripCharges - 23.6).toFixed(2));

    const fillEvent: OrderFillEvent = {
      id: `fill_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      orderId,
      instrumentKey: params.instrumentKey,
      side: params.side,
      fillQty: filledQuantity,
      fillPrice: executionPrice,
      charges,
      timestamp: now,
      estimatedCharges: params.estimatedCharges || 58.2,
      actualCharges: charges.totalRoundTripCharges,
    };

    this.fills.unshift(fillEvent);

    // 5. Update Positions Ledger
    this.updatePositionFromFill(params, executionPrice, filledQuantity);

    // 6. Broadcast Events
    this.gateway.broadcast('order.changed', brokerOrder);
    this.gateway.broadcast('fill.created', fillEvent);

    this.logger.log(
      `[PaperBroker] Order ${orderId} executed: Status=${finalStatus}, FillPrice=₹${executionPrice}, Qty=${filledQuantity}/${params.quantity}, ActualCharges=₹${charges.totalRoundTripCharges}.`,
    );

    return {
      orderId,
      tag: params.tag,
      status: 'ACKNOWLEDGED',
      message: `Paper order executed at ₹${executionPrice}.`,
    };
  }

  async modifyOrder(req: any): Promise<OrderAcknowledgement> {
    const orderId = req.orderId || req.id;
    const existing = this.orders.get(orderId);
    if (!existing) {
      throw new Error(`Order ${orderId} not found`);
    }
    if (existing.status !== OrderStatus.ACKNOWLEDGED && existing.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error(`Cannot modify order in status ${existing.status}`);
    }
    if (req.price) existing.price = req.price;
    if (req.quantity) existing.quantity = req.quantity;
    existing.updatedAt = new Date().toISOString();
    this.orders.set(orderId, existing);
    this.gateway.broadcast('order.changed', existing);
    return {
      orderId,
      tag: existing.tag,
      status: 'ACKNOWLEDGED',
      message: 'Paper order modified successfully.',
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const existing = this.orders.get(orderId);
    if (existing) {
      existing.status = OrderStatus.CANCELLED;
      existing.updatedAt = new Date().toISOString();
      this.orders.set(orderId, existing);
      this.gateway.broadcast('order.changed', existing);
    }
  }

  async placeProtectiveExit(req: {
    instrumentKey: string;
    stopLossPrice: number;
    targetPrice: number;
    quantity: number;
  }): Promise<ProtectionResult> {
    const existing = this.positions.get(req.instrumentKey);
    if (!existing || existing.netQuantity !== req.quantity || !Number.isFinite(req.stopLossPrice) || req.stopLossPrice <= 0) {
      return {
        success: false,
        protectionStatus: ExitProtectionStatus.PROTECTION_FAILED,
        stopLossPrice: req.stopLossPrice,
        targetPrice: req.targetPrice,
        confirmedQty: req.quantity,
        message: `No active open position found for instrument ${req.instrumentKey}. Protection failed.`,
      };
    }

    existing.stopLossPrice = Math.max(existing.stopLossPrice ?? 0, req.stopLossPrice);
    existing.targetPrice = req.targetPrice;
    existing.lastVerifiedAt = new Date().toISOString();
    this.positions.set(req.instrumentKey, existing);

    const gttOrderId = `gtt_paper_${Date.now()}`;
    return {
      success: true,
      gttOrderId,
      protectionStatus: ExitProtectionStatus.PROTECTED_GTT,
      stopLossPrice: req.stopLossPrice,
      targetPrice: req.targetPrice,
      confirmedQty: req.quantity,
      message: `Paper GTT protective exits placed successfully (Stop: ₹${req.stopLossPrice}, Target: ₹${req.targetPrice}). Triggers submit limit orders; not a guaranteed stop.`,
    };
  }

  public tightenProtectiveStop(instrumentKey: string, quantity: number, stopPrice: number): boolean {
    const position = this.positions.get(instrumentKey);
    const tick = this.catalog.getInstrument(instrumentKey)?.tickSize ?? 0.05;
    if (!position || position.netQuantity !== quantity || !Number.isFinite(stopPrice) || stopPrice <= 0 ||
      stopPrice < (position.stopLossPrice ?? 0) || Math.abs(stopPrice / tick - Math.round(stopPrice / tick)) > 0.00001) return false;
    position.stopLossPrice = stopPrice;
    position.lastVerifiedAt = new Date().toISOString();
    this.gateway.broadcast('position.stop.updated', { instrumentKey, quantity, stopPrice });
    return true;
  }

  private updatePositionFromFill(
    params: PlacePaperOrderParams,
    fillPrice: number,
    filledQty: number,
  ): void {
    const existing = this.positions.get(params.instrumentKey);
    const instrument = this.catalog.getInstrument(params.instrumentKey);
    const symbol = instrument?.symbol || params.instrumentKey.split('|')[1] || params.instrumentKey;

    if (params.side === OrderSide.BUY) {
      if (!existing) {
        this.positions.set(params.instrumentKey, {
          id: `pos_${Date.now()}`,
          instrumentKey: params.instrumentKey,
          symbol,
          netQuantity: filledQty,
          buyQuantity: filledQty,
          sellQuantity: 0,
          buyAvgPrice: fillPrice,
          sellAvgPrice: 0,
          lastPrice: fillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          stopLossPrice: params.stopLossPrice || Number((fillPrice * 0.92).toFixed(2)),
          targetPrice: params.disableTarget ? null : params.targetPrice || Number((fillPrice * 1.12).toFixed(2)),
          lastVerifiedAt: new Date().toISOString(),
        });
      } else {
        const totalBuyQty = existing.buyQuantity + filledQty;
        const newBuyAvg = Number(
          ((existing.buyAvgPrice * existing.buyQuantity + fillPrice * filledQty) / totalBuyQty).toFixed(2),
        );
        existing.buyQuantity = totalBuyQty;
        existing.netQuantity += filledQty;
        existing.buyAvgPrice = newBuyAvg;
        existing.lastVerifiedAt = new Date().toISOString();
        this.positions.set(params.instrumentKey, existing);
      }
    } else if (params.side === OrderSide.SELL && existing) {
      // Exit position
      const closedQty = Math.min(existing.netQuantity, filledQty);
      const grossPnl = Number(((fillPrice - existing.buyAvgPrice) * closedQty).toFixed(2));
      const charges = calculateOptionCharges({
        buyPrice: existing.buyAvgPrice,
        sellPrice: fillPrice,
        quantity: closedQty,
      });
      const netPnl = Number((grossPnl - charges.totalRoundTripCharges).toFixed(2));

      existing.sellQuantity += closedQty;
      existing.netQuantity -= closedQty;
      existing.sellAvgPrice = fillPrice;
      existing.realizedPnl += netPnl;
      existing.unrealizedPnl = 0;
      existing.lastVerifiedAt = new Date().toISOString();

      if (existing.netQuantity === 0) {
        this.positions.delete(params.instrumentKey);
      } else {
        this.positions.set(params.instrumentKey, existing);
      }
    }
  }

  private checkIfQuoteStale(quote: QuoteSnapshot | undefined): boolean {
    if (!quote) return true;
    if (quote.isStale) return true;
    const now = Date.now();
    const quoteTime = new Date(quote.timestamp).getTime();
    return !Number.isFinite(quoteTime) || quoteTime > now + 1000 || now - quoteTime > 3000 ||
      ![quote.bidPrice, quote.askPrice].every((price) => Number.isFinite(price) && price > 0) || quote.bidPrice > quote.askPrice;
  }

}
