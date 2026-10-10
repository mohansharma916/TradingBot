import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QuoteSnapshot, FeedStatus, FeedSubscriptionMode } from '@trading-bot/contracts';
import { isMarketOpenForTrading } from '@trading-bot/domain';
import { EnvService } from '../config/env.service';
import { ProtobufDecoderService, DecodedFeedResponse } from './protobuf-decoder.service';
import { EventsGateway } from '../websocket/events.gateway';
import WebSocket from 'ws';

export interface FeedHealthDetails {
  status: FeedStatus;
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
  private subscribedKeys: Set<string> = new Set();
  private quotes: Map<string, QuoteSnapshot> = new Map();
  private readonly quoteListeners = new Set<(quote: QuoteSnapshot) => void>();
  private lastTickTimestamps: Map<string, number> = new Map(); // Monotonic tick checking

  private staleCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private reconnectAttempts = 0;
  private readonly maxReconnectDelayMs = 30000;
  private readonly baseReconnectDelayMs = 1000;
  private readonly staleThresholdMs = 3000; // 3 seconds per Blueprint

  // Health and Telemetry Counters
  private totalTicksReceived = 0;
  private duplicateTicksIgnored = 0;
  private quoteGapsDetected = 0;
  private lastTickReceivedAt: string | null = null;
  private lastFeedLatencyMs = 15;

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(ProtobufDecoderService) private readonly decoder: ProtobufDecoderService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  async onModuleInit() {
    // Pre-subscribe default high-liquidity instruments
    this.subscribe([
      'NSE_INDEX|Nifty 50',
      'NSE_INDEX|Nifty Bank',
      'NSE_INDEX|Nifty Fin Service',
      'NSE_FO|NIFTY_2026-10-15_25100_CE',
      'NSE_FO|NIFTY_2026-10-15_25100_PE',
    ]);

    // Seed initial quotes
    this.seedInitialQuotes();

    // Start background stale-feed detector
    this.staleCheckTimer = setInterval(() => {
      this.checkStaleFeed();
    }, 1000);

    // Attempt connecting to market feed
    this.initiateConnection();
  }

  onModuleDestroy() {
    if (this.staleCheckTimer) clearInterval(this.staleCheckTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private seedInitialQuotes() {
    const now = new Date().toISOString();
    const defaults = [
      {
        instrumentKey: 'NSE_INDEX|Nifty 50',
        lastPrice: 25120.45,
        bidPrice: 25120.1,
        askPrice: 25120.8,
        bidQty: 500,
        askQty: 625,
        volume: 8452000,
        openInterest: 0,
        netChange: 145.2,
        netChangePct: 0.58,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_INDEX|Nifty Bank',
        lastPrice: 52450.8,
        bidPrice: 52449.5,
        askPrice: 52451.2,
        bidQty: 300,
        askQty: 450,
        volume: 4120000,
        openInterest: 0,
        netChange: -85.4,
        netChangePct: -0.16,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_INDEX|Nifty Fin Service',
        lastPrice: 24150.0,
        bidPrice: 24148.5,
        askPrice: 24151.0,
        bidQty: 250,
        askQty: 275,
        volume: 1250000,
        openInterest: 0,
        netChange: 62.1,
        netChangePct: 0.26,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 122.5,
        bidPrice: 122.2,
        askPrice: 122.8,
        bidQty: 125,
        askQty: 150,
        volume: 98500,
        openInterest: 142000,
        netChange: 14.5,
        netChangePct: 13.4,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_PE',
        lastPrice: 98.2,
        bidPrice: 97.9,
        askPrice: 98.5,
        bidQty: 100,
        askQty: 125,
        volume: 76000,
        openInterest: 110500,
        netChange: -12.4,
        netChangePct: -11.2,
        timestamp: now,
        isStale: false,
      },
    ];

    for (const q of defaults) {
      this.quotes.set(q.instrumentKey, q);
      this.lastTickTimestamps.set(q.instrumentKey, Date.now());
    }
  }

  public initiateConnection(): void {
    const apiKey = this.envService.config.UPSTOX_API_KEY;
    if (!apiKey || apiKey === 'mock_key') {
      // In simulation mode without live credentials, stay connected virtually
      this.status = FeedStatus.CONNECTED;
      console.log('[MarketFeedService] Simulation mode active. Virtual real-time quotes active.');
      return;
    }

    this.status = FeedStatus.CONNECTING;
    const wsUrl = 'wss://api.upstox.com/v3/feed/market-data-feed';

    try {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      this.ws.binaryType = 'nodebuffer';

      this.ws.on('open', () => {
        console.log('[MarketFeedService] Upstox Market Data Feed V3 WebSocket connected.');
        this.status = FeedStatus.CONNECTED;
        this.reconnectAttempts = 0;
        this.sendSubscriptionMessage(Array.from(this.subscribedKeys));
        this.gateway.broadcast('feed.status', { status: this.status });
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
          this.handleBinaryMessage(data as Buffer);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`[MarketFeedService] Feed WebSocket disconnected (code: ${code}, reason: ${reason}).`);
        if (code === 4401 || code === 401 || this.status === FeedStatus.AUTH_FAILED) {
          this.status = FeedStatus.AUTH_FAILED;
          console.error('[MarketFeedService] Critical: Upstox access token expired. Re-authentication required.');
          this.gateway.broadcast('broker.auth_expired', { message: 'Upstox OAuth session expired.' });
          return;
        }
        this.status = FeedStatus.DISCONNECTED;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[MarketFeedService] WebSocket error:', err.message);
        if (err.message.includes('401')) {
          this.status = FeedStatus.AUTH_FAILED;
          console.error('[MarketFeedService] Critical: Upstox access token unauthorized/expired (401). Re-authentication required.');
          this.gateway.broadcast('broker.auth_expired', { message: 'Upstox OAuth session unauthorized or expired.' });
          return;
        }
        this.status = FeedStatus.DISCONNECTED;
      });
    } catch (err: any) {
      console.error('[MarketFeedService] Failed to initialize WebSocket:', err.message);
      this.scheduleReconnect();
    }
  }

  public scheduleReconnect(): void {
    if (this.status === FeedStatus.AUTH_FAILED) {
      return; // Do not reconnect on expired token
    }

    this.reconnectAttempts++;
    // Exponential backoff with ±20% jitter
    const delay = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
    );
    const jitter = delay * (0.8 + Math.random() * 0.4);

    console.log(`[MarketFeedService] Reconnecting in ${Math.round(jitter)}ms (Attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.initiateConnection();
    }, jitter);
  }

  public handleBinaryMessage(buffer: Uint8Array | Buffer): DecodedFeedResponse {
    const decoded = this.decoder.decodeMarketFeed(buffer);
    const now = Date.now();
    this.lastTickReceivedAt = new Date().toISOString();
    this.totalTicksReceived++;

    if (decoded.currentTs) {
      this.lastFeedLatencyMs = Math.max(0, now - decoded.currentTs);
    }

    const updatedSnapshots: QuoteSnapshot[] = [];

    for (const [key, item] of Object.entries(decoded.feeds)) {
      const prevTimestamp = this.lastTickTimestamps.get(key) || 0;

      // 1. Duplicate check: Ignore tick if timestamp is identical or backwards
      if (item.lastTradeTime > 0 && item.lastTradeTime <= prevTimestamp) {
        this.duplicateTicksIgnored++;
        continue;
      }

      // 2. Quote gap check: Log if time gap exceeds 15 seconds during continuous market
      if (prevTimestamp > 0 && item.lastTradeTime - prevTimestamp > 15000) {
        this.quoteGapsDetected++;
      }

      this.lastTickTimestamps.set(key, item.lastTradeTime || now);

      const snapshot = this.decoder.normalizeToQuoteSnapshot(item, false);
      this.quotes.set(key, snapshot);
      for (const listener of this.quoteListeners) listener(snapshot);
      updatedSnapshots.push(snapshot);
    }

    // Broadcast quote snapshots to connected clients via WebSocket gateway
    if (updatedSnapshots.length > 0) {
      this.gateway.broadcast('quotes.snapshot', updatedSnapshots);
    }

    return decoded;
  }

  private checkStaleFeed(): void {
    const isMarketHours = isMarketOpenForTrading();
    const now = Date.now();
    let newlyStaleFound = false;

    for (const [key, quote] of this.quotes.entries()) {
      const lastTickTime = this.lastTickTimestamps.get(key) || 0;
      const isStale = isMarketHours && lastTickTime > 0 && now - lastTickTime > this.staleThresholdMs;

      if (quote.isStale !== isStale) {
        quote.isStale = isStale;
        this.quotes.set(key, { ...quote, isStale });
        if (isStale) newlyStaleFound = true;
      }
    }

    if (newlyStaleFound) {
      this.status = FeedStatus.STALE;
      this.gateway.broadcast('feed.stale', {
        message: 'Market data feed latency detected. Subscriptions marked stale.',
        timestamp: new Date().toISOString(),
      });
    } else if (this.status === FeedStatus.STALE) {
      this.status = FeedStatus.CONNECTED;
    }
  }

  public subscribe(keys: string[], mode: FeedSubscriptionMode = FeedSubscriptionMode.FULL): void {
    for (const key of keys) {
      this.subscribedKeys.add(key);
    }
    this.sendSubscriptionMessage(keys, mode);
  }

  public unsubscribe(keys: string[]): void {
    for (const key of keys) {
      this.subscribedKeys.delete(key);
      this.quotes.delete(key);
      this.lastTickTimestamps.delete(key);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          guid: `unsub_${Date.now()}`,
          method: 'unsub',
          data: { instrumentKeys: keys },
        }),
      );
    }
  }

  private sendSubscriptionMessage(keys: string[], mode: FeedSubscriptionMode = FeedSubscriptionMode.FULL): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && keys.length > 0) {
      this.ws.send(
        JSON.stringify({
          guid: `sub_${Date.now()}`,
          method: 'sub',
          data: {
            mode,
            instrumentKeys: keys,
          },
        }),
      );
    }
  }

  public getQuote(key: string): QuoteSnapshot | undefined {
    return this.quotes.get(key);
  }

  /** Observers receive actual feed/test ticks; bootstrap display quotes are excluded. */
  public observeQuotes(listener: (quote: QuoteSnapshot) => void): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  public getAllQuotes(): QuoteSnapshot[] {
    return Array.from(this.quotes.values());
  }

  public getFeedHealth(): FeedHealthDetails {
    const staleCount = Array.from(this.quotes.values()).filter((q) => q.isStale).length;
    return {
      status: this.status,
      feedLatencyMs: this.lastFeedLatencyMs,
      activeSubscriptions: this.subscribedKeys.size,
      staleCount,
      totalTicksReceived: this.totalTicksReceived,
      duplicateTicksIgnored: this.duplicateTicksIgnored,
      quoteGapsDetected: this.quoteGapsDetected,
      lastTickReceivedAt: this.lastTickReceivedAt,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // Simulator helper: inject custom tick for testing
  public injectSimulatedTick(snapshot: QuoteSnapshot): void {
    this.quotes.set(snapshot.instrumentKey, snapshot);
    for (const listener of this.quoteListeners) listener(snapshot);
    this.lastTickTimestamps.set(snapshot.instrumentKey, Date.now());
    this.gateway.broadcast('quotes.snapshot', [snapshot]);
  }
}
