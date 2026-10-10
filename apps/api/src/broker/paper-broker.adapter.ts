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
  ) {
    this.seedInitialPositions();
  }

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
    return Array.from(this.positions.values());
  }

  public getFills(): OrderFillEvent[] {
    return [...this.fills];
  }

  /**
   * Places and simulates execution of a paper order.
   */
  async placeOrder(params: PlacePaperOrderParams): Promise<OrderAcknowledgement> {
    const orderId = `ord_paper_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

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
          targetPrice: params.targetPrice || Number((fillPrice * 1.12).toFixed(2)),
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
    return now - quoteTime > 3000; // 3 seconds staleness limit
  }

  private seedInitialPositions(): void {
    // Initial sample positions for immediate display
    this.positions.set('NSE_FO|NIFTY_2026-10-15_25100_CE', {
      id: 'pos_seed_001',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY 25100 CE 2026-10-15',
      netQuantity: 25,
      buyQuantity: 25,
      sellQuantity: 0,
      buyAvgPrice: 122.5,
      sellAvgPrice: 0,
      lastPrice: 126.5,
      unrealizedPnl: 100.0, // (126.5 - 122.5) * 25
      realizedPnl: 0,
      stopLossPrice: 114.0,
      targetPrice: 136.0,
      lastVerifiedAt: new Date().toISOString(),
    });
  }
}
