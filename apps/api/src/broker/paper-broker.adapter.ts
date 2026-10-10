import { Injectable, Inject, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
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
  BrokerOrderSchema,
  PositionSchema,
} from '@trading-bot/contracts';
import { calculateOptionCharges, ChargeBreakdown } from '@trading-bot/domain';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { EventsGateway } from '../websocket/events.gateway';
import { EnvService } from '../config/env.service';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

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
  chargesSource?: 'SIMULATED' | 'ESTIMATED' | 'BROKER_CONFIRMED';
}

export interface PlacePaperOrderParams {
  expectedModeRevision?: number;
  beforeBuyDispatch?: () => void;
  proposalId?: string;
  reservationId?: string;
  signalKey?: string;
  symbol?: string;
  reservedCapital?: number;
  reservedRisk?: number;
  entryIntentId?: string;
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
  private readonly storagePath: string | null;
  private readonly initialCash: number;
  private persistenceFailed = false;

  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(EnvService) env?: EnvService,
    @Optional() @Inject('PAPER_BROKER_STORAGE_PATH') storagePath?: string,
  ) {
    this.initialCash = env?.config.MAX_ACCOUNT_CAPITAL_INR ?? 10000;
    this.storagePath = storagePath ? path.resolve(storagePath) : process.env.VITEST ? null : path.resolve(env?.config.STATE_DIRECTORY || process.env.STATE_DIRECTORY || '.data', 'paper-broker.json');
    if (this.storagePath) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        const saved = z.object({ version: z.literal(1), orders: z.array(BrokerOrderSchema.extend({ id: z.string().min(1), intentId: z.string().min(1) })), positions: z.array(PositionSchema.extend({ id: z.string().min(1) })), fills: z.array(z.object({
          id: z.string(), orderId: z.string(), instrumentKey: z.string(), side: z.nativeEnum(OrderSide), fillQty: z.number().int().positive(),
          fillPrice: z.number().positive(), charges: z.any(), timestamp: z.string(), estimatedCharges: z.number(), actualCharges: z.number().nonnegative(), chargesSource: z.enum(['SIMULATED', 'ESTIMATED', 'BROKER_CONFIRMED']).optional(),
        })) }).parse(raw);
        this.orders = new Map(saved.orders.map((order) => [order.id, order])); this.positions = new Map(saved.positions.map((position) => [position.instrumentKey, position])); this.fills = saved.fills as OrderFillEvent[];
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ServiceUnavailableException('Paper broker ledger cannot be validated; simulator trading is blocked.'); }
    }
  }

  async getConnectionHealth(): Promise<BrokerHealth> {
    const feedHealth = this.feed.getFeedHealth();
    const connected = (this.feed.getAllQuotes?.().length ?? 0) > 0 && feedHealth.staleCount === 0;
    return {
      broker: 'UPSTOX',
      status: connected ? BrokerHealthStatus.HEALTHY : BrokerHealthStatus.DEGRADED,
      isAuthenticated: false,
      tokenExpiresAt: null,
      registeredEgressIp: 'UNVERIFIED',
      currentEgressIp: 'UNVERIFIED',
      ipMatches: false,
      marketFeedConnected: connected,
      feedLatencyMs: feedHealth.feedLatencyMs,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getFunds(): Promise<FundsSnapshot> {
    const available = this.initialCash + this.fills.reduce((sum, fill) => sum + (fill.side === OrderSide.SELL ? 1 : -1) * fill.fillPrice * fill.fillQty - fill.actualCharges, 0);
    const margin = Array.from(this.positions.values()).reduce((sum, position) => sum + position.buyAvgPrice * position.netQuantity, 0);
    return {
      source: 'PAPER_SIMULATION', status: 'SIMULATED', verifiedAt: new Date().toISOString(),
      currency: 'INR',
      availableCash: Number(Math.max(0, available).toFixed(2)),
      usedMargin: Number(margin.toFixed(2)),
      totalCollateral: Number((available + margin).toFixed(2)),
      payinAmount: 0.0,
      spanMargin: 0.0,
      exposureMargin: 0.0,
    };
  }

  async getMargin(_instrumentKey: string, quantity: number, price?: number): Promise<MarginEstimate> {
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price! <= 0) throw new Error('A quantity and observed premium are required for a simulated margin estimate.');
    const required = quantity * price!;
    return {
      requiredMargin: required,
      finalMargin: required,
      shortfall: Math.max(0, required - (await this.getFunds()).availableCash),
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
    const lots: Array<{ remaining: number; fill: OrderFillEvent }> = [];
    let entryCharges = 0;
    for (const fill of [...this.fills].reverse().filter((item) => item.instrumentKey === exits[0]!.instrumentKey)) {
      if (fill.side === OrderSide.BUY) { lots.push({ remaining: fill.fillQty, fill }); continue; }
      let remaining = fill.fillQty;
      for (const lot of lots) {
        const used = Math.min(remaining, lot.remaining);
        if (fill.orderId === orderId) entryCharges += lot.fill.actualCharges * used / lot.fill.fillQty;
        remaining -= used; lot.remaining -= used;
        if (!remaining) break;
      }
      if (remaining) return undefined;
    }
    const exitPrice = exits.reduce((sum, fill) => sum + fill.fillPrice * fill.fillQty, 0) / quantity;
    const charges = Number((entryCharges + exits.reduce((sum, fill) => sum + fill.actualCharges, 0)).toFixed(2));
    return { exitPrice, charges, netPnl: Number(((exitPrice - buyPrice) * quantity - charges).toFixed(2)) };
  }

  /** Rehydrate only a durably confirmed simulator entry; never fabricate an unresolved fill. */
  public restoreConfirmedPosition(trade: DailyBotTrade): void {
    const persisted = this.orders.get(trade.orderId);
    if (persisted) {
      const position = this.positions.get(trade.instrumentKey);
      if (!position || position.netQuantity !== trade.quantity || position.buyAvgPrice !== trade.entryPrice || persisted.filledQuantity !== trade.quantity) throw new Error('Persisted paper exposure conflicts with Daily Bot recovery.');
      return;
    }
    if (this.positions.size || !trade.reservationId || !trade.openedAt || trade.entryActualCharges === undefined || trade.status !== 'OPEN') throw new Error('Confirmed paper position cannot be restored from incomplete or conflicting metadata.');
    this.positions.set(trade.instrumentKey, { id: `restored_${trade.orderId}`, instrumentKey: trade.instrumentKey, symbol: trade.symbol, netQuantity: trade.quantity, buyQuantity: trade.quantity, sellQuantity: 0, buyAvgPrice: trade.entryPrice, sellAvgPrice: 0, lastPrice: trade.currentPrice, unrealizedPnl: trade.grossPnl ?? 0, realizedPnl: 0, stopLossPrice: trade.stopPrice, targetPrice: null, lastVerifiedAt: trade.openedAt });
    this.orders.set(trade.orderId, { id: trade.orderId, intentId: trade.reservationId, brokerOrderId: trade.orderId, tag: 'RESTORED_DAILY_ENTRY', instrumentKey: trade.instrumentKey, side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: trade.quantity, price: trade.entryPrice, status: OrderStatus.FILLED, filledQuantity: trade.quantity, averageFillPrice: trade.entryPrice, createdAt: trade.openedAt, updatedAt: trade.openedAt });
    const charges = calculateOptionCharges({ buyPrice: trade.entryPrice, sellPrice: 0, quantity: trade.quantity });
    charges.brokerage = 20;
    charges.gst = Number((charges.gst - 3.6).toFixed(2));
    charges.totalRoundTripCharges = trade.entryActualCharges;
    this.fills.unshift({ id: `restored_fill_${trade.orderId}`, orderId: trade.orderId, instrumentKey: trade.instrumentKey, side: OrderSide.BUY, fillQty: trade.quantity, fillPrice: trade.entryPrice, timestamp: trade.openedAt, estimatedCharges: trade.estimatedCharges, actualCharges: trade.entryActualCharges, charges });
    this.persist();
  }

  /**
   * Places and simulates execution of a paper order.
   */
  async placeOrder(params: PlacePaperOrderParams): Promise<OrderAcknowledgement> {
    if (this.persistenceFailed) throw new ServiceUnavailableException('Paper broker persistence failed; restart after repairing storage.');
    params = { ...params, tag: (params.tag || params.intentId).slice(0, 20) };
    if (![OrderSide.BUY, OrderSide.SELL].includes(params.side) || ![OrderType.MARKET, OrderType.LIMIT].includes(params.orderType)) throw new Error('Paper execution supports explicit BUY/SELL market and limit orders; trigger orders require the protection workflow.');
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
      this.persist();
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
    const basePrice = params.side === OrderSide.BUY ? quote!.askPrice : quote!.bidPrice;
    const slippage = params.side === OrderSide.BUY ? 0.25 : -0.25;
    const tick = this.catalog.getInstrument(params.instrumentKey)?.tickSize ?? 0.05;
    const executable = Math.max(1.0, basePrice + slippage);
    const executionPrice = Number(((params.side === OrderSide.BUY ? Math.ceil((executable - 1e-9) / tick) : Math.floor((executable + 1e-9) / tick)) * tick).toFixed(2));
    const entryFees = calculateOptionCharges({ buyPrice: executionPrice, sellPrice: 0, quantity: params.quantity }).totalRoundTripCharges - 23.6;
    if (params.side === OrderSide.BUY && executionPrice * params.quantity + entryFees > (await this.getFunds()).availableCash) return { orderId, tag: params.tag, status: 'REJECTED', message: 'Virtual account cash does not cover this paper entry and fees.' };
    if (params.side === OrderSide.BUY) params.beforeBuyDispatch?.();
    if (params.maximumExecutionPrice !== undefined && executionPrice > params.maximumExecutionPrice) {
      return { orderId, tag: params.tag, status: 'REJECTED', message: 'Executable ask moved above the reserved entry price; refresh and revalidate the signal.' };
    }
    if (params.orderType === OrderType.LIMIT && (!params.price || (params.side === OrderSide.BUY ? executionPrice > params.price : executionPrice < params.price))) {
      this.orders.set(orderId, { id: orderId, intentId: params.intentId, brokerOrderId: orderId, tag: params.tag, instrumentKey: params.instrumentKey,
        side: params.side, orderType: params.orderType, product: params.product, quantity: params.quantity, price: params.price, status: OrderStatus.ACKNOWLEDGED,
        filledQuantity: 0, averageFillPrice: 0, createdAt: now, updatedAt: now });
      this.persist();
      return { orderId, tag: params.tag, status: 'ACKNOWLEDGED', message: 'Limit is not executable at the current bid/ask plus slippage. No paper fill was fabricated; cancel or reprice explicitly.' };
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
      chargesSource: 'SIMULATED',
    };

    this.fills.unshift(fillEvent);

    // 5. Update Positions Ledger
    this.updatePositionFromFill(params, executionPrice, filledQuantity);
    this.persist();

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
    this.persist();
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
    if (!existing) throw new Error('Paper order is not present.');
    if ([OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CLOSED].includes(existing.status)) throw new Error('A terminal paper order cannot be cancelled.');
    if (existing.status !== OrderStatus.CANCELLED) {
      existing.status = OrderStatus.CANCELLED;
      existing.updatedAt = new Date().toISOString();
      this.orders.set(orderId, existing);
      this.persist();
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
    this.persist();

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
    this.persist();
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

  private persist(): void {
    if (!this.storagePath) return;
    const directory = path.dirname(this.storagePath); const temporary = path.join(directory, `.paper-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({ version: 1, orders: Array.from(this.orders.values()), positions: Array.from(this.positions.values()), fills: this.fills })}\n`);
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, this.storagePath);
      fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    } catch { this.persistenceFailed = true; throw new ServiceUnavailableException('Paper order state was not durably confirmed. Simulator entries are blocked.'); }
    finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

}
