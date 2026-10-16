import { Injectable, Inject, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QuoteSnapshot, FeedStatus, FeedSubscriptionMode } from '@trading-bot/contracts';
import { EnvService } from '../config/env.service';
import { ProtobufDecoderService, DecodedFeedResponse } from './protobuf-decoder.service';
import { EventsGateway } from '../websocket/events.gateway';
import { TokenStorageService } from '../broker/token-storage.service';
import WebSocket from 'ws';

export interface FeedHealthDetails {
  status: FeedStatus;
  provenance: 'LIVE' | 'DELAYED' | 'SIMULATED' | 'UNAVAILABLE';
  feedLatencyMs: number;
  activeSubscriptions: number;
  staleCount: number;
  totalTicksReceived: number;
  duplicateTicksIgnored: number;
  quoteGapsDetected: number;
  lastTickReceivedAt: string | null;
  reconnectAttempts: number;
}

@Injectable()
export class UpstoxMarketFeedService implements OnModuleInit, OnModuleDestroy {
  private ws: WebSocket | null = null;
  private status: FeedStatus = FeedStatus.DISCONNECTED;
  private readonly subscriptions = new Map<string, FeedSubscriptionMode>();
  private readonly quotes = new Map<string, QuoteSnapshot>();
  private readonly quoteListeners = new Set<(quote: QuoteSnapshot) => void>();
  private readonly lastEventTimestamps = new Map<string, number>();
  private staleCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private connecting = false;
  private reconnectAttempts = 0;
  private readonly staleThresholdMs = process.env.NODE_ENV === 'test' ? 3000 : 15000;
  private totalTicksReceived = 0;
  private duplicateTicksIgnored = 0;
  private quoteGapsDetected = 0;
  private lastTickReceivedAt: string | null = null;
  private lastFeedLatencyMs = 0;
  private authorizationToken: string | null = null;
  private lastIndexSnapshotAt = 0;
  private lastOnDemandIndexRefreshAt = 0;
  private indexRefreshInFlight: Promise<void> | null = null;

  constructor(
    @Inject(EnvService) _envService: EnvService,
    @Inject(ProtobufDecoderService) private readonly decoder: ProtobufDecoderService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(TokenStorageService) private readonly tokenStorage?: TokenStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.stopped = false;
    this.subscribe(['NSE_INDEX|Nifty 50', 'NSE_INDEX|Nifty Bank', 'NSE_INDEX|Nifty Fin Service', 'NSE_INDEX|NIFTY MID SELECT']);
    this.staleCheckTimer = setInterval(() => this.checkStaleFeed(), 1000);
    await this.initiateConnection();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.staleCheckTimer) clearInterval(this.staleCheckTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus(FeedStatus.DISCONNECTED);
  }

  private setStatus(status: FeedStatus): void {
    const changed = this.status !== status;
    this.status = status;
    if (status === FeedStatus.DISCONNECTED || status === FeedStatus.AUTH_FAILED) {
      for (const [key, quote] of this.quotes) {
        if (quote.provenance === 'LIVE') this.quotes.set(key, { ...quote, isStale: true, provenance: 'DELAYED' });
      }
    }
    if (changed) this.gateway.broadcast('feed.status', { status, provenance: this.getFeedHealth().provenance });
  }

  public async initiateConnection(): Promise<void> {
    if (this.stopped || this.connecting || this.ws?.readyState === WebSocket.OPEN) return;
    // An application key is not an OAuth access token.
    const record = this.tokenStorage?.getToken();
    if (!record?.accessToken || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
      this.setStatus(FeedStatus.DISCONNECTED);
      return;
    }
    if (this.status === FeedStatus.AUTH_FAILED && this.authorizationToken === record.accessToken) return;
    this.authorizationToken = record.accessToken;
    this.connecting = true;
    this.setStatus(FeedStatus.CONNECTING);
    try {
      const response = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
        headers: { Authorization: `Bearer ${record.accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403) {
        this.setStatus(FeedStatus.AUTH_FAILED);
        this.gateway.broadcast('broker.auth_expired', { message: 'Broker market feed authentication failed.' });
        return;
      }
      if (!response.ok) throw new Error(`Feed authorization returned HTTP ${response.status}`);
      const body = await response.json() as any;
      const wsUrl = body?.data?.authorized_redirect_uri || body?.data?.authorizedRedirectUri;
      if (typeof wsUrl !== 'string' || !wsUrl.startsWith('wss://')) throw new Error('Authorized feed URL unavailable.');
      if (this.stopped) return;
      const socket = new WebSocket(wsUrl, { handshakeTimeout: 10000 });
      this.ws = socket;
      socket.binaryType = 'nodebuffer';
      socket.on('open', () => {
        if (this.stopped || this.ws !== socket) { socket.close(); return; }
        this.setStatus(FeedStatus.CONNECTED);
        this.reconnectAttempts = 0;
        for (const [key, mode] of this.subscriptions) this.sendSubscriptionMessage([key], mode);
      });
      socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary || this.ws !== socket) return;
        try {
          const buffer = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
          this.handleBinaryMessage(buffer);
        } catch {
          this.setStatus(FeedStatus.STALE);
          this.gateway.broadcast('feed.stale', { message: 'Invalid market data packet rejected.', timestamp: new Date().toISOString() });
        }
      });
      socket.on('close', (code) => {
        if (this.ws !== socket) return;
        this.ws = null;
        this.setStatus(code === 4401 || code === 401 ? FeedStatus.AUTH_FAILED : FeedStatus.DISCONNECTED);
        if (!this.stopped) this.scheduleReconnect();
      });
      socket.on('error', () => {
        if (this.ws !== socket) return;
        this.setStatus(FeedStatus.DISCONNECTED);
        socket.close();
        this.scheduleReconnect();
      });
    } catch {
      this.setStatus(FeedStatus.DISCONNECTED);
      this.scheduleReconnect();
    } finally { this.connecting = false; }
  }

  public scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.status === FeedStatus.AUTH_FAILED) return;
    this.reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.initiateConnection();
    }, delay * (0.8 + Math.random() * 0.4));
  }

  public handleBinaryMessage(buffer: Uint8Array | Buffer): DecodedFeedResponse {
    const decoded = this.decoder.decodeMarketFeed(buffer);
    const receivedAt = new Date().toISOString();
    const now = Date.now();
    this.lastTickReceivedAt = receivedAt;
    this.totalTicksReceived++;
    if (decoded.currentTs > 0) this.lastFeedLatencyMs = Math.max(0, now - decoded.currentTs);
    const updates: QuoteSnapshot[] = [];
    for (const [key, item] of Object.entries(decoded.feeds)) {
      const sourceTime = item.eventTime || item.lastTradeTime;
      const previous = this.lastEventTimestamps.get(key) || 0;
      if (sourceTime > 0 && sourceTime <= previous) { this.duplicateTicksIgnored++; continue; }
      if (previous > 0 && sourceTime - previous > 15000) this.quoteGapsDetected++;
      if (sourceTime > 0) this.lastEventTimestamps.set(key, sourceTime);
      const snapshot = this.decoder.normalizeToQuoteSnapshot(item, false, 'LIVE', receivedAt);
      this.quotes.set(key, snapshot);
      for (const listener of this.quoteListeners) listener(snapshot);
      updates.push(snapshot);
    }
    if (updates.length) this.gateway.broadcast('quotes.snapshot', updates);
    return decoded;
  }

  private checkStaleFeed(): void {
    const now = Date.now();
    const record = this.tokenStorage?.getToken();
    const authenticated = !!record?.accessToken && Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > now;
    if (this.ws && (!authenticated || record!.accessToken !== this.authorizationToken)) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
      this.setStatus(FeedStatus.DISCONNECTED);
    }
    if (authenticated && now - this.lastIndexSnapshotAt >= 60_000) {
      this.lastIndexSnapshotAt = now;
      void this.refreshMissingIndexQuotes().catch(() => undefined);
    }
    // OAuth may be completed after startup, or replaced after expiry.
    if (!this.stopped && authenticated && !this.ws && !this.connecting && !this.reconnectTimer &&
      !(this.status === FeedStatus.AUTH_FAILED && record!.accessToken === this.authorizationToken)) void this.initiateConnection();
    let changed = false;
    let anyStale = false;
    for (const [key, quote] of this.quotes) {
      const sourceAge = now - Date.parse(quote.timestamp);
      const receiptAge = quote.receivedAt ? now - Date.parse(quote.receivedAt) : Infinity;
      const stale = quote.isStale || quote.provenance === 'UNAVAILABLE' || quote.provenance === 'DELAYED' ||
        !Number.isFinite(sourceAge) || sourceAge < -1000 || sourceAge > this.staleThresholdMs || receiptAge > this.staleThresholdMs;
      if (stale && quote.provenance === 'LIVE') {
        this.quotes.set(key, { ...quote, isStale: true, provenance: 'DELAYED' });
        changed = true;
      } else if (stale !== quote.isStale) { this.quotes.set(key, { ...quote, isStale: stale }); changed = true; }
      anyStale ||= stale;
    }
    // Transport status can recover only when a real open socket receives fresh data.
    if (this.ws?.readyState === WebSocket.OPEN) this.setStatus(anyStale ? FeedStatus.STALE : FeedStatus.CONNECTED);
    if (changed) this.gateway.broadcast('quotes.snapshot', this.getAllQuotes());
  }

  public subscribe(keys: string[], mode: FeedSubscriptionMode = FeedSubscriptionMode.FULL): void {
    const valid = keys.filter((key) => typeof key === 'string' && /^NSE_(?:INDEX\|[^|]+|FO\|\d+)$/.test(key));
    if (valid.length !== keys.length) throw new Error('Subscriptions require broker-issued instrument keys.');
    if (new Set([...this.subscriptions.keys(), ...valid]).size > 1500) throw new Error('Market feed subscription limit exceeded.');
    for (const key of valid) this.subscriptions.set(key, mode);
    this.sendSubscriptionMessage(valid, mode);
  }

  public unsubscribe(keys: string[]): void {
    for (const key of keys) { this.subscriptions.delete(key); this.quotes.delete(key); this.lastEventTimestamps.delete(key); }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(Buffer.from(JSON.stringify({ guid: `unsub_${Date.now()}`, method: 'unsub', data: { instrumentKeys: keys } })), { binary: true });
  }

  private sendSubscriptionMessage(keys: string[], mode: FeedSubscriptionMode): void {
    if (this.ws?.readyState === WebSocket.OPEN && keys.length) this.ws.send(Buffer.from(JSON.stringify({ guid: `sub_${Date.now()}`, method: 'sub', data: { mode, instrumentKeys: keys } })), { binary: true });
  }

  /**
   * Index cards need a price even before the open, after the close or while the socket reconnects.
   * Indices without a current LIVE tick are filled from the REST quote snapshot as DELAYED, which
   * entry freshness checks never accept, so this is display-only.
   */
  public async refreshMissingIndexQuotes(): Promise<void> {
    const missing = [...this.subscriptions.keys()].filter((key) => key.startsWith('NSE_INDEX|') && !this.isFreshLive(this.quotes.get(key)));
    if (missing.length) await this.syncRealMarketPrices(missing);
  }

  /**
   * Called on read paths (watchlist) so every index card has a price on the first response instead of
   * waiting for the 60s background refresh. Shares one in-flight request and rate-limits REST calls.
   */
  public async ensureIndexQuotes(): Promise<void> {
    const hasEmpty = [...this.subscriptions.keys()].some((key) => key.startsWith('NSE_INDEX|') && !this.quotes.has(key));
    if (!hasEmpty) return;
    if (!this.indexRefreshInFlight) {
      if (Date.now() - this.lastOnDemandIndexRefreshAt < 5_000) return;
      this.lastOnDemandIndexRefreshAt = Date.now();
      this.indexRefreshInFlight = this.refreshMissingIndexQuotes().catch(() => undefined).finally(() => { this.indexRefreshInFlight = null; });
    }
    await this.indexRefreshInFlight;
  }

  private isFreshLive(quote: QuoteSnapshot | undefined): boolean {
    return quote?.provenance === 'LIVE' && !quote.isStale;
  }

  /** REST snapshots are explicitly delayed; no Yahoo fallback or fabricated depth. */
  public async syncRealMarketPrices(keys: string[] = [...this.subscriptions.keys()]): Promise<void> {
    const record = this.tokenStorage?.getToken();
    keys = keys.filter((key) => this.subscriptions.has(key)).slice(0, 500);
    if (!record?.accessToken || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now() || !keys.length) return;
    // encodeURIComponent keeps spaces as %20 ("Nifty 50"); URLSearchParams would send '+'.
    const response = await fetch(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(keys.join(','))}`, {
      headers: { Authorization: `Bearer ${record.accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Quote snapshot returned HTTP ${response.status}`);
    const body = await response.json() as any;
    const receivedAt = new Date().toISOString();
    for (const row of Object.values<any>(body.data || {})) {
      const key = row.instrument_token;
      const lastTradeTime = Number(row.last_trade_time);
      if (typeof key !== 'string' || !this.subscriptions.has(key) || !Number.isFinite(row.last_price) || row.last_price <= 0) continue;
      // A live tick that arrived during the request is newer than this snapshot.
      if (this.isFreshLive(this.quotes.get(key))) continue;
      const bids = (row.depth?.buy || []).filter((level: any) => level.price > 0 && level.quantity > 0).slice(0, 5).map((level: any) => ({ price: level.price, quantity: level.quantity }));
      const asks = (row.depth?.sell || []).filter((level: any) => level.price > 0 && level.quantity > 0).slice(0, 5).map((level: any) => ({ price: level.price, quantity: level.quantity }));
      const snapshot = this.decoder.normalizeToQuoteSnapshot({
        instrumentKey: key, lastPrice: row.last_price, closePrice: Number(row.ohlc?.close) || 0,
        lastTradeTime: Number.isFinite(lastTradeTime) ? lastTradeTime : 0, eventTime: 0, lastTradeQty: Number(row.last_trade_quantity) || 0,
        netChange: Number(row.net_change) || 0, netChangePct: 0, volume: Number(row.volume) || 0, openInterest: Number(row.oi) || 0, depth: { bids, asks },
      }, true, 'DELAYED', receivedAt);
      this.quotes.set(key, snapshot);
    }
    this.gateway.broadcast('quotes.snapshot', this.getAllQuotes());
  }

  public setQuotes(quotes: QuoteSnapshot[]): void {
    for (const q of quotes) {
      this.quotes.set(q.instrumentKey, q);
    }
    if (quotes.length) {
      this.gateway.broadcast('quotes.snapshot', quotes);
    }
  }

  public getQuote(key: string): QuoteSnapshot | undefined { return this.quotes.get(key); }
  public observeQuotes(listener: (quote: QuoteSnapshot) => void): () => void { this.quoteListeners.add(listener); return () => this.quoteListeners.delete(listener); }
  public getAllQuotes(): QuoteSnapshot[] { return [...this.quotes.values()]; }
  public getFeedHealth(): FeedHealthDetails {
    const live = [...this.quotes.values()].some((quote) => quote.provenance === 'LIVE' && !quote.isStale && Date.now() - Date.parse(quote.receivedAt || '') <= this.staleThresholdMs);
    const simulated = [...this.quotes.values()].some((quote) => quote.provenance === 'SIMULATED');
    return {
      status: this.status, provenance: live ? 'LIVE' : simulated ? 'SIMULATED' : [...this.quotes.values()].some((quote) => quote.provenance === 'DELAYED') ? 'DELAYED' : 'UNAVAILABLE',
      feedLatencyMs: this.lastFeedLatencyMs, activeSubscriptions: this.subscriptions.size,
      staleCount: [...this.quotes.values()].filter((quote) => quote.isStale).length,
      totalTicksReceived: this.totalTicksReceived, duplicateTicksIgnored: this.duplicateTicksIgnored,
      quoteGapsDetected: this.quoteGapsDetected, lastTickReceivedAt: this.lastTickReceivedAt, reconnectAttempts: this.reconnectAttempts,
    };
  }

  /** Explicit test-only injection cannot be promoted to LIVE provenance. */
  public injectSimulatedTick(snapshot: QuoteSnapshot): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('Simulated tick injection is available only to tests.');
    const quote = { ...snapshot, provenance: 'SIMULATED' as const, receivedAt: new Date().toISOString(), depthKnown: snapshot.bidPrice > 0 && snapshot.askPrice >= snapshot.bidPrice && snapshot.bidQty > 0 && snapshot.askQty > 0 };
    this.quotes.set(quote.instrumentKey, quote);
    for (const listener of this.quoteListeners) listener(quote);
    this.gateway.broadcast('quotes.snapshot', [quote]);
  }
}
