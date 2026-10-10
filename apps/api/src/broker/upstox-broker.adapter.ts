import { Injectable, Inject, Optional, UnauthorizedException } from '@nestjs/common';
import { BrokerPort, FundsSnapshot, MarginEstimate, OrderAcknowledgement, ConfirmedOrderFill } from './broker.port';
import { BrokerHealth, BrokerHealthStatus, BrokerOrder, Instrument, Position, ExitProtectionStatus, ProtectionResult, OrderSide, OrderStatus } from '@trading-bot/contracts';
import { EnvService } from '../config/env.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { TokenStorageService } from './token-storage.service';
import { LiveExecutionLedgerService } from './live-execution-ledger.service';
import { OrderFillEvent } from './paper-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { TradingModeService } from '../trading/trading-mode.service';

export class BrokerRequestError extends Error {
  constructor(message: string, public readonly definiteRejection = false) { super(message); }
}

/** Official broker responses are required; simulator credentials never authorize this adapter. */
@Injectable()
export class UpstoxBrokerAdapter implements BrokerPort {
  public readonly brokerName = 'UPSTOX_V3';
  private requests: number[] = [];
  private lastVerifiedAt: string | null = null;
  private readonly protectionRequests = new Map<string, Promise<ProtectionResult>>();
  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(TokenStorageService) private readonly tokenStorage: TokenStorageService,
    @Optional() @Inject(LiveExecutionLedgerService) private readonly ledger?: LiveExecutionLedgerService,
    @Optional() @Inject(RiskReservationManager) private readonly risk?: RiskReservationManager,
    @Optional() @Inject(TradingModeService) private readonly mode?: TradingModeService,
  ) {}
  public hasLiveToken(): boolean {
    if (!this.tokenStorage.hasValidToken()) return false;
    const token = this.tokenStorage.getToken()?.accessToken;
    return typeof token === 'string' && token.length > 0 && !/^(mock_|test_|upstox_sand_|upstox_ref_)/i.test(token);
  }
  public getAuthHeader(): Record<string, string> {
    if (!this.hasLiveToken()) throw new UnauthorizedException('A valid genuine Upstox OAuth token is required; test and simulated tokens cannot authorize live broker requests.');
    const algoName = this.envService.config.UPSTOX_ALGO_NAME?.trim();
    // Official order/GTT APIs require this when an exchange-approved algo name applies.
    return { Authorization: `Bearer ${this.tokenStorage.getToken()!.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(algoName ? { 'X-Algo-Name': algoName } : {}) };
  }
  private async request(url: string, init: RequestInit = {}): Promise<any> {
    const accessToken = this.tokenStorage.getToken()?.accessToken;
    const headers = this.getAuthHeader();
    const now = Date.now(); this.requests = this.requests.filter((time) => now - time < 1000);
    if (this.requests.length >= 20) throw new BrokerRequestError('Broker request budget exhausted; retry after reconciliation.', true);
    this.requests.push(now);
    const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(5000) });
    const assertSession = (): void => {
      if (this.tokenStorage.getToken()?.accessToken !== accessToken) throw new BrokerRequestError('Broker authentication changed during the request; this response cannot verify the current account.', !init.method || init.method === 'GET');
    };
    assertSession();
    if (!response.ok) throw new BrokerRequestError(`Upstox request failed HTTP ${response.status}.`, response.status >= 400 && response.status < 500);
    const body = await response.json();
    assertSession();
    if (body?.status !== 'success' || !Object.prototype.hasOwnProperty.call(body, 'data')) throw new BrokerRequestError('Upstox response did not confirm success.');
    this.lastVerifiedAt = new Date().toISOString(); return body.data;
  }
  private assertWrites(): void {
    if (!this.envService.config.LIVE_EXECUTION_ENABLED) throw new Error('Live order execution is disabled by LIVE_EXECUTION_ENABLED.');
    this.getAuthHeader();
    if (!this.ledger) throw new Error('Durable live execution ledger is required before submitting a live order.');
  }
  private hft(endpoint: string): string { return `${this.envService.config.UPSTOX_HFT_URL}${endpoint}`; }
  private api(endpoint: string): string { return `${this.envService.config.UPSTOX_BASE_URL}${endpoint}`; }
  private assertBuyDispatchAllowed(req: any, revision: number | undefined, accessToken: string | undefined): void {
    try {
      this.assertWrites();
      if (!accessToken || this.tokenStorage.getToken()?.accessToken !== accessToken) throw new Error('Broker authentication changed before BUY dispatch. Reverify the account before entry.');
      if (!this.risk || !this.mode || !this.mode.isLive() || this.mode.getRevision() !== revision) throw new Error('Live entry mode changed or its final dispatch guard is unavailable.');
      this.risk.assertEntryAllowed();
      const reservation = this.risk.getReservation(req.reservationId);
      if (!reservation || reservation.status !== 'HELD' || reservation.instrumentKey !== req.instrumentKey ||
        !Number.isFinite(req.reservedCapital) || Math.abs(reservation.reservedCapital - req.reservedCapital) > 0.01) throw new Error('Live BUY requires a matching held account reservation at dispatch.');
      if (req.beforeBuyDispatch) {
        if (typeof req.beforeBuyDispatch !== 'function') throw new Error('The server entry revalidation hook is invalid.');
        const result = req.beforeBuyDispatch();
        if (result && typeof result.then === 'function') throw new Error('Final entry revalidation must be synchronous.');
      }
    } catch (error) { throw new BrokerRequestError(error instanceof Error ? error.message : 'Live entry dispatch was revoked.', true); }
  }
  async getConnectionHealth(): Promise<BrokerHealth> {
    const authenticated = this.hasLiveToken();
    return { broker: 'UPSTOX', status: authenticated && this.lastVerifiedAt ? BrokerHealthStatus.HEALTHY : BrokerHealthStatus.DEGRADED,
      isAuthenticated: authenticated && this.lastVerifiedAt !== null, tokenExpiresAt: this.tokenStorage.getTokenMetadata().expiresAt,
      registeredEgressIp: this.envService.config.UPSTOX_EGRESS_IP, currentEgressIp: 'UNVERIFIED', ipMatches: false,
      marketFeedConnected: false, feedLatencyMs: 0, lastSeenAt: this.lastVerifiedAt || new Date().toISOString() };
  }
  async getFunds(): Promise<FundsSnapshot> {
    if (!this.hasLiveToken()) return { source: 'UNAVAILABLE', status: 'UNAVAILABLE', currency: 'INR', availableCash: 0, usedMargin: 0, totalCollateral: 0, payinAmount: 0, spanMargin: 0, exposureMargin: 0 };
    // V2 available_margin includes trading margin. Option buys require actual cash, never pledged collateral.
    // https://upstox.com/developer/api-documentation/get-funds-and-margin-v3/
    const data = await this.request(this.api('/user/get-funds-and-margin'), { headers: { 'Api-Version': '3.0' } });
    const cash = data?.available_to_trade?.cash_available_to_trade;
    const pledge = data?.available_to_trade?.pledge_available_to_trade;
    if (!cash || !Number.isFinite(cash.total) || cash.total < 0) throw new Error('Broker funds unavailable: missing or invalid cash available to trade.');
    const amount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return { source: 'LIVE_BROKER', status: 'VERIFIED', verifiedAt: this.lastVerifiedAt!, currency: 'INR', availableCash: cash.total,
      usedMargin: amount(cash.margin_used?.total) + amount(pledge?.margin_used?.total), totalCollateral: amount(pledge?.margin_from_pledge?.total),
      payinAmount: amount(cash.cash?.added_today), spanMargin: amount(cash.margin_used?.span_exposure) + amount(pledge?.margin_used?.span_exposure), exposureMargin: 0 };
  }
  async getMargin(_instrumentKey: string, _quantity: number, _price?: number): Promise<MarginEstimate> {
    throw new Error('Live margin estimate is unavailable; no simulated margin or zero shortfall is returned. Long-option buys require verified available broker funds.');
  }
  async getInstrument(key: string): Promise<Instrument | undefined> { return this.catalog.getInstrument(key); }
  public normalizeOrderStatus(value: unknown): OrderStatus {
    const text = String(value).toLowerCase().replace(/[_-]/g, ' ').trim();
    if (['complete', 'filled'].includes(text)) return OrderStatus.FILLED;
    if (text === 'rejected') return OrderStatus.REJECTED;
    if (['cancelled', 'canceled'].includes(text)) return OrderStatus.CANCELLED;
    if (['partially filled', 'partial'].includes(text)) return OrderStatus.PARTIALLY_FILLED;
    return OrderStatus.ACKNOWLEDGED;
  }
  private brokerTimestamp(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Broker order timestamp is unavailable; historical orders cannot be assigned to an owned position safely.');
    const iso = value.includes('T') ? value : value.replace(' ', 'T');
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}+05:30`;
    if (!Number.isFinite(Date.parse(withZone))) throw new Error('Broker order timestamp is invalid.');
    return new Date(withZone).toISOString();
  }
  async getOrders(): Promise<BrokerOrder[]> {
    const data = await this.request('https://api.upstox.com/v2/order/retrieve-all');
    if (!Array.isArray(data)) throw new Error('Broker orders response is incomplete; account state is unknown.');
    const orders: BrokerOrder[] = data.map((order: any) => {
      if (typeof order.order_id !== 'string' || !Number.isInteger(order.quantity) || !Number.isInteger(order.filled_quantity) || order.filled_quantity < 0 || !Number.isFinite(order.average_price)) throw new Error('Broker order response has invalid quantity or fill metadata.');
      return { id: order.order_id, intentId: order.tag || order.order_id, brokerOrderId: order.order_id, tag: order.tag || 'EXTERNAL', instrumentKey: order.instrument_token,
        side: order.transaction_type, orderType: order.order_type, product: order.product, quantity: order.quantity, price: order.price,
        status: this.normalizeOrderStatus(order.status), filledQuantity: order.filled_quantity, averageFillPrice: order.average_price,
        createdAt: this.brokerTimestamp(order.order_timestamp), updatedAt: this.lastVerifiedAt! };
    });
    this.ledger?.observeOrders(orders); return orders;
  }
  async getPositions(): Promise<Position[]> {
    const data = await this.request('https://api.upstox.com/v2/portfolio/short-term-positions');
    if (!Array.isArray(data)) throw new Error('Broker positions response is incomplete; account state is unknown.');
    return data.map((position: any) => {
      if (typeof position.instrument_token !== 'string' || !Number.isInteger(position.quantity) || !Number.isFinite(position.buy_price) || !Number.isFinite(position.sell_price)) throw new Error('Broker position response has invalid quantity or price.');
      const owned = this.ledger?.getEntryForInstrument(position.instrument_token);
      return { id: `upstox_${position.instrument_token}`, instrumentKey: position.instrument_token, symbol: position.trading_symbol,
        netQuantity: position.quantity, buyQuantity: position.buy_quantity || 0, sellQuantity: position.sell_quantity || 0,
        buyAvgPrice: position.buy_price, sellAvgPrice: position.sell_price, lastPrice: position.last_price || 0,
        unrealizedPnl: position.unrealised || 0, realizedPnl: position.realised || 0, stopLossPrice: owned?.stopLossPrice ?? null,
        targetPrice: null, lastVerifiedAt: this.lastVerifiedAt! };
    });
  }
  public getFills(): OrderFillEvent[] { return this.ledger?.getFills() || []; }
  async placeOrder(req: any): Promise<OrderAcknowledgement> {
    try { this.assertWrites(); } catch (error) { throw new BrokerRequestError(error instanceof Error ? error.message : 'Live order write authorization is unavailable.', true); }
    if (!Number.isInteger(req.quantity) || req.quantity <= 0 || ![OrderSide.BUY, OrderSide.SELL].includes(req.side)) throw new BrokerRequestError('Positive integer quantity and explicit BUY/SELL direction are required.', true);
    const previous = this.ledger!.getIntent(req.intentId);
    if (previous) {
      if (previous.instrumentKey !== req.instrumentKey || previous.quantity !== req.quantity || previous.side !== req.side) throw new Error('Durable intent parameters conflict with the existing broker request; no replay is allowed.');
      if (!previous.orderIds.length) throw new Error('An unresolved durable intent already exists; reconcile before retrying.');
      return { orderId: previous.orderIds[0]!, orderIds: previous.orderIds, tag: req.tag || req.intentId, status: previous.state === OrderStatus.REJECTED ? 'REJECTED' : 'ACKNOWLEDGED', message: 'Existing durable intent returned; no order was resubmitted.' };
    }
    const revision = req.expectedModeRevision ?? this.mode?.getRevision();
    const accessToken = this.tokenStorage.getToken()?.accessToken;
    if (req.side === OrderSide.BUY) {
      this.assertBuyDispatchAllowed(req, revision, accessToken);
      const funds = await this.getFunds(); const capital = req.reservedCapital ?? req.quantity * (req.maximumExecutionPrice ?? req.price ?? 0);
      if (funds.status !== 'VERIFIED' || funds.source !== 'LIVE_BROKER' || !Number.isFinite(capital) || capital <= 0 || capital > funds.availableCash) throw new BrokerRequestError('Verified broker cash does not cover this entry.', true);
      this.assertBuyDispatchAllowed(req, revision, accessToken);
      try {
        const positions = await this.getPositions();
        this.assertBuyDispatchAllowed(req, revision, accessToken);
        if (positions.some((position) => position.netQuantity !== 0)) throw new Error('Current broker exposure is not flat; a new BUY is blocked.');
        const orders = await this.getOrders();
        this.assertBuyDispatchAllowed(req, revision, accessToken);
        if (orders.some((order) => ![OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(order.status))) throw new Error('A current broker order remains pending or unresolved; a new BUY is blocked.');
      } catch (error) {
        this.risk!.setKillSwitch(true);
        throw new BrokerRequestError(error instanceof Error ? error.message : 'Current broker account state cannot be verified before entry.', true);
      }
    }
    const payload = { quantity: req.quantity, product: req.product || 'I', validity: req.validity || 'DAY', price: req.price || 0,
      tag: (req.tag || req.intentId).slice(0, 20), instrument_token: req.instrumentKey, order_type: req.orderType || 'LIMIT', transaction_type: req.side,
      disclosed_quantity: 0, trigger_price: req.triggerPrice || 0, is_amo: false, slice: false, market_protection: -1 };
    this.ledger!.beginIntent({ ...req, side: req.side });
    try {
      if (req.side === OrderSide.BUY) this.assertBuyDispatchAllowed(req, revision, accessToken);
      // https://upstox.com/developer/api-documentation/v3/place-order/
      const data = await this.request(this.hft('/order/place'), { method: 'POST', body: JSON.stringify(payload) });
      if (!Array.isArray(data?.order_ids) || data.order_ids.length === 0 || data.order_ids.some((id: unknown) => typeof id !== 'string' || !id)) throw new BrokerRequestError('Broker acknowledgement omitted order_ids; dispatch outcome is unknown.');
      this.ledger!.markAcknowledged(req.intentId, data.order_ids);
      return { orderId: data.order_ids[0], orderIds: data.order_ids, tag: payload.tag, status: 'ACKNOWLEDGED', message: 'Broker accepted the order. Fill confirmation is pending.' };
    } catch (error) {
      this.ledger!.update(req.intentId, { state: error instanceof BrokerRequestError && error.definiteRejection ? OrderStatus.REJECTED : OrderStatus.UNKNOWN_BROKER_STATE,
        message: error instanceof Error ? error.message : 'Dispatch failed.' }); throw error;
    }
  }
  async confirmFill(ack: OrderAcknowledgement, expectedQuantity: number): Promise<ConfirmedOrderFill> {
    const ids = ack.orderIds || [ack.orderId];
    let result: ConfirmedOrderFill = { status: OrderStatus.UNKNOWN_BROKER_STATE, filledQuantity: 0, averagePrice: 0, complete: false, terminal: false, orderIds: ids };
    for (let attempt = 0; attempt < 5; attempt++) {
      const orders = await this.getOrders(); const matched = ids.map((id) => orders.find((order) => order.id === id));
      if (matched.every((order) => order !== undefined)) {
        const confirmed = matched as BrokerOrder[]; const quantity = confirmed.reduce((sum, order) => sum + order.filledQuantity, 0);
        const price = quantity ? confirmed.reduce((sum, order) => sum + order.filledQuantity * order.averageFillPrice, 0) / quantity : 0;
        const terminal = confirmed.every((order) => [OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED].includes(order.status));
        result = { orderIds: ids, complete: quantity === expectedQuantity && terminal && price > 0, terminal, filledQuantity: quantity, averagePrice: price,
          status: quantity === expectedQuantity ? OrderStatus.FILLED : quantity > 0 ? OrderStatus.PARTIALLY_FILLED : terminal ? confirmed[0]!.status : OrderStatus.ACKNOWLEDGED };
        if (quantity > expectedQuantity || (quantity > 0 && (!Number.isFinite(price) || price <= 0))) throw new Error('Confirmed broker fill exceeds owned quantity or has an invalid price.');
        if (terminal || quantity > 0) return result;
      }
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return result;
  }
  async modifyOrder(req: any): Promise<OrderAcknowledgement> {
    this.assertWrites();
    const data = await this.request(this.hft('/order/modify'), { method: 'PUT', body: JSON.stringify({ order_id: req.orderId, quantity: req.quantity, price: req.price, trigger_price: req.triggerPrice || 0, order_type: req.orderType || 'LIMIT', validity: 'DAY' }) });
    if (data?.order_id !== req.orderId && !data?.order_ids?.includes(req.orderId)) throw new Error('Broker did not confirm the modified order ID.');
    return { orderId: req.orderId, tag: req.tag || 'MODIFIED', status: 'ACKNOWLEDGED', message: 'Modification accepted; confirm the resulting broker order before proceeding.' };
  }
  async cancelOrder(orderId: string): Promise<void> {
    this.assertWrites();
    const data = await this.request(this.hft(`/order/cancel?order_id=${encodeURIComponent(orderId)}`), { method: 'DELETE' });
    if (data?.order_id !== orderId && !data?.order_ids?.includes(orderId)) throw new Error('Broker did not confirm the cancelled order ID.');
  }
  async placeProtectiveExit(req: { instrumentKey: string; stopLossPrice: number; targetPrice: number; quantity: number; product?: string }): Promise<ProtectionResult> {
    const running = this.protectionRequests.get(req.instrumentKey);
    if (running) return running;
    const pending = this.scheduleProtectiveExit(req);
    this.protectionRequests.set(req.instrumentKey, pending);
    try { return await pending; } finally { this.protectionRequests.delete(req.instrumentKey); }
  }
  private async scheduleProtectiveExit(req: { instrumentKey: string; stopLossPrice: number; targetPrice: number; quantity: number; product?: string }): Promise<ProtectionResult> {
    this.assertWrites();
    if (!Number.isFinite(req.stopLossPrice) || req.stopLossPrice <= 0 || !Number.isInteger(req.quantity) || req.quantity <= 0) throw new Error('Protective stop price and owned quantity must be valid.');
    const entry = this.ledger!.getEntryForInstrument(req.instrumentKey);
    if (!entry || entry.filledQuantity !== req.quantity) throw new Error('Protective order has no matching confirmed owned entry.');
    if (entry.gttOrderId) {
      await this.verifyProtectiveExit(entry.gttOrderId, req.instrumentKey, req.quantity, req.stopLossPrice);
      this.ledger!.setProtection(entry.intentId, entry.gttOrderId, req.stopLossPrice);
      return { success: true, gttOrderId: entry.gttOrderId, protectionStatus: ExitProtectionStatus.PROTECTED_GTT, stopLossPrice: req.stopLossPrice,
        targetPrice: req.targetPrice, confirmedQty: req.quantity, message: 'Existing broker stop verified; no duplicate stop submitted. Target remains server managed.' };
    }
    if (entry.protectionDispatchPending) throw new Error('A protective stop dispatch has an unknown outcome. No duplicate GTT will be submitted until manual broker reconciliation.');
    // SINGLE SELL ENTRY protects an already filled long position. A MULTIPLE BUY ENTRY would open another position.
    // https://upstox.com/developer/api-documentation/place-gtt-order/
    const payload = { type: 'SINGLE', quantity: req.quantity, product: req.product || 'I', instrument_token: req.instrumentKey,
      transaction_type: 'SELL', rules: [{ strategy: 'ENTRY', trigger_type: 'BELOW', trigger_price: req.stopLossPrice, market_protection: -1 }] };
    this.ledger!.update(entry.intentId, { protectionDispatchPending: true, protectionVerified: false });
    let data: any;
    try { data = await this.request(this.api('/order/gtt/place'), { method: 'POST', body: JSON.stringify(payload) }); }
    catch (error) {
      if (error instanceof BrokerRequestError && error.definiteRejection) this.ledger!.update(entry.intentId, { protectionDispatchPending: false });
      throw error;
    }
    const id = data?.gtt_order_id;
    if (typeof id !== 'string' || !id) throw new Error('Broker did not return a protective GTT ID.');
    // Keep a known broker ID even if the following read fails. An ambiguous verification must not orphan an actual stop.
    this.ledger!.update(entry.intentId, { gttOrderId: id, stopLossPrice: req.stopLossPrice, protectionDispatchPending: false, protectionVerified: false, state: OrderStatus.EXIT_PROTECTION_PENDING });
    await this.verifyProtectiveExit(id, req.instrumentKey, req.quantity, req.stopLossPrice);
    this.ledger!.setProtection(entry.intentId, id, req.stopLossPrice);
    return { success: true, gttOrderId: id, protectionStatus: ExitProtectionStatus.PROTECTED_GTT, stopLossPrice: req.stopLossPrice,
      targetPrice: req.targetPrice, confirmedQty: req.quantity, message: 'Broker-confirmed stop GTT is scheduled. Target is monitored by the server, not an armed broker target. Trigger execution is not guaranteed.' };
  }
  public async verifyProtectiveExit(id: string, instrumentKey: string, quantity: number, stopLossPrice: number): Promise<void> {
    // Completed GTTs disappear from this endpoint. Absence is unknown until SELL fills and flat positions are reconciled.
    // https://upstox.com/developer/api-documentation/get-gtt-order-details/
    const details = await this.request(this.api(`/order/gtt?gtt_order_id=${encodeURIComponent(id)}`));
    const gtt = Array.isArray(details) ? details.find((item: any) => item.gtt_order_id === id) : undefined;
    const stop = gtt?.rules?.find((rule: any) => rule.strategy === 'ENTRY');
    if (!gtt || gtt.instrument_token !== instrumentKey || gtt.quantity !== quantity || stop?.trigger_type !== 'BELOW' || stop?.transaction_type !== 'SELL' || stop?.trigger_price !== stopLossPrice || stop?.status !== 'SCHEDULED') throw new Error('Broker protective stop could not be verified against the filled position.');
  }
  public async reconcileStopAfterFlat(gttOrderId: string, instrumentKey: string): Promise<void> {
    const details = await this.request(this.api(`/order/gtt?gtt_order_id=${encodeURIComponent(gttOrderId)}`));
    if (!Array.isArray(details)) throw new Error('Broker stop state is unavailable after the exit.');
    const gtt = details.find((item: any) => item.gtt_order_id === gttOrderId);
    if (gtt) {
      if (gtt.instrument_token !== instrumentKey) throw new Error('Broker stop instrument does not match the closed position.');
      await this.cancelProtectiveExit(gttOrderId);
    }
    // An absent completed GTT does not prove cancellation. Callers still require complete owned SELL fills,
    // no active SELL orders, and a flat position; no new SELL is dispatched on the basis of absence.
  }
  async cancelProtectiveExit(gttOrderId: string): Promise<void> {
    this.assertWrites();
    // https://upstox.com/developer/api-documentation/cancel-gtt-order/
    const data = await this.request(this.api('/order/gtt/cancel'), { method: 'DELETE', body: JSON.stringify({ gtt_order_id: gttOrderId }) });
    if (data?.gtt_order_id !== gttOrderId && !data?.gtt_order_ids?.includes(gttOrderId)) throw new Error('Broker did not confirm stop cancellation; no competing exit will be submitted.');
    const entry = this.ledger!.getEntries().find((intent) => intent.gttOrderId === gttOrderId);
    if (entry) this.ledger!.update(entry.intentId, { gttOrderId: undefined, protectionVerified: false, state: OrderStatus.FILLED });
  }
}
