import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProtobufDecoderService } from '../market-data/protobuf-decoder.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { EnvService } from '../config/env.service';
import { EventsGateway } from '../websocket/events.gateway';
import { FeedStatus } from '@trading-bot/contracts';

describe('Market Data Feed V3 & Protobuf Decoder', () => {
  let decoder: ProtobufDecoderService;

  beforeEach(async () => {
    decoder = new ProtobufDecoderService();
    await decoder.loadProto();
  });

  describe('ProtobufDecoderService', () => {
    it('encodes and decodes Upstox full_feed protobuf binary payload correctly', () => {
      const now = Date.now();
      const rawPayload = {
        type: 1, // live_feed
        currentTs: now,
        feeds: {
          'NSE_FO|52175': {
            fullFeed: {
              ltp: 124.5,
              cp: 110.0,
              ltt: now,
              ltq: 25,
              vtt: 85000,
              oi: 120000,
              change: 14.5,
              marketOHLC: {
                open: 112.0,
                high: 126.0,
                low: 108.5,
                close: 110.0,
              },
              marketLevel: {
                bidAskQuote: [
                  { bp: 124.2, bq: 125, b_orders: 4, ap: 124.8, aq: 150, a_orders: 5 },
                  { bp: 124.0, bq: 250, b_orders: 8, ap: 125.0, aq: 300, a_orders: 9 },
                ],
              },
            },
          },
        },
      };

      const binaryBuffer = decoder.encodeMarketFeed(rawPayload);
      expect(Buffer.isBuffer(binaryBuffer) || binaryBuffer instanceof Uint8Array).toBe(true);
      expect(binaryBuffer.length).toBeGreaterThan(0);

      const decoded = decoder.decodeMarketFeed(binaryBuffer);
      expect(decoded.type).toBe('live_feed');
      expect(decoded.currentTs).toBe(now);

      const item = decoded.feeds['NSE_FO|52175'];
      expect(item).toBeDefined();
      expect(item?.lastPrice).toBe(124.5);
      expect(item?.closePrice).toBe(110.0);
      expect(item?.netChange).toBe(14.5);
      expect(item?.volume).toBe(85000);
      expect(item?.openInterest).toBe(120000);
      expect(item?.openPrice).toBe(112.0);
      expect(item?.highPrice).toBe(126.0);
      expect(item?.depth?.bids.length).toBe(2);
      expect(item?.depth?.asks.length).toBe(2);
      expect(item?.depth?.bids[0]?.price).toBe(124.2);
      expect(item?.depth?.asks[0]?.price).toBe(124.8);
    });

    it('decodes ltpc feed and normalizes to QuoteSnapshot', () => {
      const now = Date.now();
      const rawPayload = {
        type: 0, // initial_feed
        currentTs: now,
        feeds: {
          'NSE_INDEX|Nifty 50': {
            ltpc: {
              ltp: 25120.45,
              cp: 24975.25,
              ltt: now,
              ltq: 50,
            },
          },
        },
      };

      const binaryBuffer = decoder.encodeMarketFeed(rawPayload);
      const decoded = decoder.decodeMarketFeed(binaryBuffer);

      const item = decoded.feeds['NSE_INDEX|Nifty 50'];
      expect(item).toBeDefined();
      expect(item?.lastPrice).toBe(25120.45);
      expect(item?.closePrice).toBe(24975.25);

      const snapshot = decoder.normalizeToQuoteSnapshot(item!, false);
      expect(snapshot.instrumentKey).toBe('NSE_INDEX|Nifty 50');
      expect(snapshot.lastPrice).toBe(25120.45);
      expect(snapshot.bidPrice).toBe(25120.45); // Defaults to ltp when no depth in ltpc
      expect(snapshot.isStale).toBe(false);
    });
  });

  describe('UpstoxMarketFeedService resilience & state machine', () => {
    let feedService: UpstoxMarketFeedService;
    let mockGateway: EventsGateway;

    beforeEach(() => {
      const envService = new EnvService();
      mockGateway = {
        broadcast: vi.fn(),
      } as any;
      feedService = new UpstoxMarketFeedService(envService, decoder, mockGateway);
    });

    it('filters out duplicate ticks with identical or older timestamps', () => {
      const timestamp = 1760088000000;
      const tick1 = {
        type: 1,
        currentTs: timestamp,
        feeds: {
          'NSE_FO|52175': {
            ltpc: { ltp: 120.0, cp: 110.0, ltt: timestamp, ltq: 25 },
          },
        },
      };

      const buffer1 = decoder.encodeMarketFeed(tick1);
      feedService.handleBinaryMessage(buffer1);

      const healthAfterFirst = feedService.getFeedHealth();
      expect(healthAfterFirst.totalTicksReceived).toBe(1);
      expect(healthAfterFirst.duplicateTicksIgnored).toBe(0);

      // Send identical duplicate tick
      feedService.handleBinaryMessage(buffer1);
      const healthAfterDuplicate = feedService.getFeedHealth();
      expect(healthAfterDuplicate.totalTicksReceived).toBe(2);
      expect(healthAfterDuplicate.duplicateTicksIgnored).toBe(1);
    });

    it('detects quote gaps when tick timestamp jump exceeds threshold', () => {
      const timestamp1 = 1760088000000;
      const buffer1 = decoder.encodeMarketFeed({
        type: 1,
        currentTs: timestamp1,
        feeds: {
          'NSE_FO|52175': {
            ltpc: { ltp: 120.0, cp: 110.0, ltt: timestamp1, ltq: 25 },
          },
        },
      });
      feedService.handleBinaryMessage(buffer1);

      // Next tick 30 seconds later (> 15s quote gap threshold)
      const timestamp2 = timestamp1 + 30000;
      const buffer2 = decoder.encodeMarketFeed({
        type: 1,
        currentTs: timestamp2,
        feeds: {
          'NSE_FO|52175': {
            ltpc: { ltp: 122.0, cp: 110.0, ltt: timestamp2, ltq: 25 },
          },
        },
      });
      feedService.handleBinaryMessage(buffer2);

      const health = feedService.getFeedHealth();
      expect(health.quoteGapsDetected).toBe(1);
    });

    it('handles simulated ticks and updates quote store', () => {
      const sample = {
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 130.0,
        bidPrice: 129.8,
        askPrice: 130.2,
        bidQty: 100,
        askQty: 100,
        volume: 50000,
        openInterest: 100000,
        timestamp: new Date().toISOString(),
        isStale: false,
      };

      feedService.injectSimulatedTick(sample);
      const retrieved = feedService.getQuote('NSE_FO|NIFTY_2026-10-15_25100_CE');
      expect(retrieved).toBeDefined();
      expect(retrieved?.lastPrice).toBe(130.0);
      expect(mockGateway.broadcast).toHaveBeenCalledWith('quotes.snapshot', [sample]);
    });
  });
});
