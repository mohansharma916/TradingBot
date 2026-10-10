import { Injectable, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { BrokerOrder, OrderSide, OrderStatus, OrderType, Position, ProductType } from '@trading-bot/contracts';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OrderFillEvent } from './paper-broker.adapter';
import { calculateOptionCharges } from '@trading-bot/domain';
import { EnvService } from '../config/env.service';

const IntentSchema = z.object({
  intentId: z.string().min(1), proposalId: z.string().optional(), reservationId: z.string().optional(), signalKey: z.string().optional(),
  instrumentKey: z.string().min(1), symbol: z.string(), side: z.nativeEnum(OrderSide), product: z.nativeEnum(ProductType),
  quantity: z.number().int().positive(), reservedCapital: z.number().nonnegative(), reservedRisk: z.number().nonnegative(),
  state: z.nativeEnum(OrderStatus), orderIds: z.array(z.string()), filledQuantity: z.number().int().nonnegative(), averagePrice: z.number().nonnegative(),
  stopLossPrice: z.number().optional(), targetPrice: z.number().optional(), gttOrderId: z.string().optional(), protectionVerified: z.boolean().optional(), protectionDispatchPending: z.boolean().optional(),
  entryIntentId: z.string().optional(), settledPnl: z.number().optional(), filledAt: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), message: z.string().optional(),
});
export type LiveExecutionIntent = z.infer<typeof IntentSchema>;
const StateSchema = z.object({ version: z.literal(1), intents: z.array(IntentSchema) });

/** Broker-confirmed live intents only. Each mutation is fsynced before it is visible. */
@Injectable()
export class LiveExecutionLedgerService {
  public readonly storagePath: string;
  private state: z.infer<typeof StateSchema>;
  private failed = false;
  private readonly locks = new Set<string>();
  constructor(@Optional() @Inject('LIVE_EXECUTION_LEDGER_PATH') storagePath?: string, @Optional() @Inject(EnvService) env?: EnvService) {
    this.storagePath = path.resolve(storagePath || process.env.LIVE_EXECUTION_LEDGER_PATH || path.resolve(env?.config.STATE_DIRECTORY || process.env.STATE_DIRECTORY || '.data', 'live-execution.json'));
    try { this.state = StateSchema.parse(JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ServiceUnavailableException('Live execution ledger cannot be validated. Trading is blocked until storage is repaired.');
      this.state = { version: 1, intents: [] };
    }
  }
  public getEntries(): LiveExecutionIntent[] { return structuredClone(this.state.intents); }
  /** Shared process lock: reconciliation must not attach protection while an entry workflow owns it. */
  public tryLockIntent(intentId: string): boolean { if (this.locks.has(intentId)) return false; this.locks.add(intentId); return true; }
  public unlockIntent(intentId: string): void { this.locks.delete(intentId); }
  public getIntent(intentId: string): LiveExecutionIntent | undefined { return this.getEntries().find((intent) => intent.intentId === intentId); }
  public getEntryForInstrument(key: string): LiveExecutionIntent | undefined {
    return this.getEntries().find((intent) => intent.side === OrderSide.BUY && intent.instrumentKey === key && ![OrderStatus.CLOSED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(intent.state));
  }
  public hasUnresolvedExposure(): boolean {
    return this.state.intents.some((intent) => ![OrderStatus.CLOSED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(intent.state));
  }
  public beginIntent(req: any): LiveExecutionIntent {
    if (this.failed) throw new ServiceUnavailableException('Live execution ledger persistence failed. Restart after repairing storage.');
    if (typeof req.intentId !== 'string' || !req.intentId) throw new Error('A durable unique intentId is required for live orders.');
    const previous = this.getIntent(req.intentId);
    if (previous) return previous;
    if (req.side === OrderSide.BUY && req.proposalId && this.state.intents.some((intent) => intent.proposalId === req.proposalId)) throw new Error('Proposal already has a recorded live intent; do not replay it.');
    const now = new Date().toISOString();
    const record = IntentSchema.parse({ ...req, symbol: req.symbol || req.instrumentKey, product: req.product || ProductType.I,
      reservedCapital: req.reservedCapital ?? req.quantity * (req.price || 0), reservedRisk: req.reservedRisk ?? 0,
      state: OrderStatus.SUBMITTING, orderIds: [], filledQuantity: 0, averagePrice: 0, createdAt: now, updatedAt: now });
    this.commit({ ...this.state, intents: [...this.state.intents, record] });
    return record;
  }
  public update(intentId: string, changes: Partial<LiveExecutionIntent>): void {
    const next = structuredClone(this.state);
    const record = next.intents.find((intent) => intent.intentId === intentId);
    if (!record) throw new Error('Live order intent is not present in durable storage.');
    Object.assign(record, changes, { updatedAt: new Date().toISOString() });
    this.commit(next);
  }
  public markAcknowledged(intentId: string, ids: string[]): void { this.update(intentId, { orderIds: ids, state: OrderStatus.ACKNOWLEDGED }); }
  public observeOrders(orders: BrokerOrder[]): void {
    const next = structuredClone(this.state);
    let changed = false;
    for (const intent of next.intents) {
      if (!intent.orderIds.length || [OrderStatus.CLOSED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(intent.state)) continue;
      const matched = intent.orderIds.map((id) => orders.find((order) => order.id === id));
      if (matched.some((order) => !order)) continue;
      const confirmed = matched as BrokerOrder[];
      const quantity = confirmed.reduce((sum, order) => sum + order.filledQuantity, 0);
      const average = quantity ? confirmed.reduce((sum, order) => sum + order.filledQuantity * order.averageFillPrice, 0) / quantity : 0;
      if (quantity < intent.filledQuantity || quantity > intent.quantity || (quantity > 0 && (!Number.isFinite(average) || average <= 0))) throw new Error('Broker fill quantity or price conflicts with the durable intent.');
      const terminal = confirmed.every((order) => [OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status));
      const state = quantity === intent.quantity ? (intent.gttOrderId && intent.protectionVerified ? OrderStatus.PROTECTED : OrderStatus.FILLED)
        : quantity > 0 ? (intent.gttOrderId && intent.protectionVerified ? OrderStatus.PROTECTED : OrderStatus.PARTIALLY_FILLED)
        : terminal ? (confirmed.every((order) => order.status === OrderStatus.REJECTED) ? OrderStatus.REJECTED : OrderStatus.CANCELLED) : OrderStatus.ACKNOWLEDGED;
      if (intent.filledQuantity !== quantity || intent.averagePrice !== average || intent.state !== state) {
        if (quantity > 0 && !intent.filledAt) intent.filledAt = new Date().toISOString();
        intent.filledQuantity = quantity; intent.averagePrice = average; intent.state = state; intent.updatedAt = new Date().toISOString(); changed = true;
      }
    }
    if (changed) this.commit(next);
  }
  public setProtection(intentId: string, gttOrderId: string, stopLossPrice: number): void { this.update(intentId, { gttOrderId, stopLossPrice, protectionVerified: true, state: OrderStatus.PROTECTED }); }
  public settleExit(exitIntentId: string, pnl: number): boolean {
    const exit = this.getIntent(exitIntentId);
    if (!exit || exit.side !== OrderSide.SELL || exit.filledQuantity !== exit.quantity || exit.state === OrderStatus.CLOSED) return false;
    const next = structuredClone(this.state);
    const current = next.intents.find((intent) => intent.intentId === exitIntentId)!;
    current.state = OrderStatus.CLOSED; current.settledPnl = pnl; current.updatedAt = new Date().toISOString();
    const entry = next.intents.find((intent) => intent.intentId === exit.entryIntentId);
    if (entry) { entry.state = OrderStatus.CLOSED; entry.settledPnl = pnl; entry.gttOrderId = undefined; entry.updatedAt = current.updatedAt; }
    this.commit(next); return true;
  }
  public getOrders(): BrokerOrder[] {
    return this.state.intents.map((intent) => ({ id: intent.orderIds[0] || intent.intentId, intentId: intent.intentId, brokerOrderId: intent.orderIds[0] || null,
      tag: intent.intentId.slice(0, 20), instrumentKey: intent.instrumentKey, side: intent.side, product: intent.product, orderType: OrderType.LIMIT,
      quantity: intent.quantity, status: intent.state, filledQuantity: intent.filledQuantity, averageFillPrice: intent.averagePrice, createdAt: intent.createdAt, updatedAt: intent.updatedAt }));
  }
  public getPositions(): Position[] {
    return this.state.intents.filter((intent) => intent.side === OrderSide.BUY && intent.filledQuantity > 0 && intent.state !== OrderStatus.CLOSED).map((intent) => {
      const sold = this.state.intents.filter((exit) => exit.entryIntentId === intent.intentId).reduce((sum, exit) => sum + exit.filledQuantity, 0);
      return { id: intent.intentId, instrumentKey: intent.instrumentKey, symbol: intent.symbol, netQuantity: Math.max(0, intent.filledQuantity - sold),
        buyQuantity: intent.filledQuantity, sellQuantity: sold, buyAvgPrice: intent.averagePrice, sellAvgPrice: 0, lastPrice: intent.averagePrice,
        unrealizedPnl: 0, realizedPnl: intent.settledPnl ?? 0, stopLossPrice: intent.stopLossPrice ?? null, targetPrice: null, lastVerifiedAt: intent.updatedAt };
    }).filter((position) => position.netQuantity > 0);
  }
  /** Charges remain estimates until a broker contract note confirms them. */
  public getFills(): OrderFillEvent[] {
    return this.state.intents.filter((intent) => intent.filledQuantity > 0).map((intent) => {
      const charges = calculateOptionCharges({ buyPrice: intent.side === OrderSide.BUY ? intent.averagePrice : 0, sellPrice: intent.side === OrderSide.SELL ? intent.averagePrice : 0, quantity: intent.filledQuantity });
      charges.brokerage = 20; charges.gst = Number((charges.gst - 3.6).toFixed(2)); charges.totalRoundTripCharges = Number((charges.totalRoundTripCharges - 23.6).toFixed(2));
      return { id: `live_fill_${intent.intentId}`, orderId: intent.orderIds[0]!, instrumentKey: intent.instrumentKey, side: intent.side, fillQty: intent.filledQuantity,
        fillPrice: intent.averagePrice, charges, timestamp: intent.filledAt || intent.createdAt, estimatedCharges: charges.totalRoundTripCharges, actualCharges: charges.totalRoundTripCharges,
        chargesSource: 'ESTIMATED' } as OrderFillEvent;
    });
  }
  private commit(next: z.infer<typeof StateSchema>): void {
    const parsed = StateSchema.parse(next);
    const directory = path.dirname(this.storagePath); const temporary = path.join(directory, `.live-${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(parsed)}\n`); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, this.storagePath); descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      this.state = parsed;
    } catch { this.failed = true; throw new ServiceUnavailableException('Live intent could not be durably recorded. New live requests are blocked.'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
