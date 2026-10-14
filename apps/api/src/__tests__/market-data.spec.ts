import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtobufDecoderService } from '../market-data/protobuf-decoder.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { FeedStatus } from '@trading-bot/contracts';

const now = Date.parse('2026-10-10T06:00:00Z');
const marketPacket = (timestamp = now, ltt = now) => ({
  type: 1, currentTs: timestamp, feeds: { 'NSE_FO|52175': { fullFeed: { marketFF: {
    ltpc: { ltp: 124.5, cp: 110, ltt, ltq: 65 }, vtt: 85000, oi: 120000,
    marketOHLC: { ohlc: [{ interval: '1d', open: 112, high: 126, low: 108.5, close: 124.5, vol: 85000, ts: now }] },
    marketLevel: { bidAskQuote: [{ bidP: 124.2, bidQ: 130, askP: 124.8, askQ: 195 }] },
  } } } },
});

describe('Official Upstox V3 decoding and provenance', () => {
  let decoder: ProtobufDecoderService;
  let feed: UpstoxMarketFeedService;
  let gateway: { broadcast: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    decoder = new ProtobufDecoderService(); await decoder.loadProto();
    vi.useFakeTimers(); vi.setSystemTime(now);
    gateway = { broadcast: vi.fn() };
    feed = new UpstoxMarketFeedService({ config: { UPSTOX_API_KEY: 'not-an-access-token' } } as any, decoder, gateway as any);
  });
  afterEach(() => { feed.onModuleDestroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('decodes V3 marketFF LTPC, actual depth and OHLC arrays', () => {
    const decoded = decoder.decodeMarketFeed(decoder.encodeMarketFeed(marketPacket()));
    const item = decoded.feeds['NSE_FO|52175']!;
    expect(item).toMatchObject({ lastPrice: 124.5, closePrice: 110, volume: 85000, openInterest: 120000, openPrice: 112, highPrice: 126 });
    expect(item.depth?.bids[0]).toEqual({ price: 124.2, quantity: 130 });
    expect(decoder.normalizeToQuoteSnapshot(item)).toMatchObject({ provenance: 'LIVE', depthKnown: true, isStale: false, receivedAt: new Date(now).toISOString() });
  });

  it('does not invent executable depth for indexFF or LTPC messages', () => {
    for (const union of [{ ltpc: { ltp: 25120.45, cp: 24975, ltt: now } }, { fullFeed: { indexFF: { ltpc: { ltp: 25120.45, cp: 24975, ltt: now } } } }]) {
      const data = decoder.decodeMarketFeed(decoder.encodeMarketFeed({ type: 1, currentTs: now, feeds: { 'NSE_INDEX|Nifty 50': union } }));
      expect(decoder.normalizeToQuoteSnapshot(data.feeds['NSE_INDEX|Nifty 50']!)).toMatchObject({ lastPrice: 25120.45, bidPrice: 0, askPrice: 0, bidQty: 0, askQty: 0, depthKnown: false });
    }
  });

  it('handles market status packets without inventing quotes', () => {
    const packet = decoder.encodeMarketFeed({ type: 2, currentTs: now, marketInfo: { segmentStatus: { NSE_FO: 3 } } });
    expect(decoder.decodeMarketFeed(packet)).toMatchObject({ type: 'market_info', feeds: {}, marketInfo: { segmentStatus: { NSE_FO: 'NORMAL_CLOSE' } } });
  });

  it('retains missing timestamps as unavailable and old timestamps as delayed', () => {
    const old = decoder.decodeMarketFeed(decoder.encodeMarketFeed(marketPacket(now - 10000, now - 10000))).feeds['NSE_FO|52175']!;
    expect(decoder.normalizeToQuoteSnapshot(old)).toMatchObject({ provenance: 'DELAYED', isStale: true, timestamp: new Date(now - 10000).toISOString() });
    const missing = { ...old, eventTime: 0, lastTradeTime: 0 };
    expect(decoder.normalizeToQuoteSnapshot(missing)).toMatchObject({ provenance: 'UNAVAILABLE', isStale: true, timestamp: '1970-01-01T00:00:00.000Z' });
  });

  it('does not seed quotes or use an API application key as OAuth credentials', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await feed.onModuleInit(); vi.advanceTimersByTime(10000);
    expect(fetch).not.toHaveBeenCalled();
    expect(feed.getAllQuotes()).toEqual([]);
    expect(feed.getFeedHealth()).toMatchObject({ status: FeedStatus.DISCONNECTED, provenance: 'UNAVAILABLE', totalTicksReceived: 0 });
  });

  it('rejects invented instrument keys and sends subscription messages as binary', () => {
    expect(() => feed.subscribe(['NSE_FO|NIFTY_2026-10-15_25100_CE'])).toThrow('broker-issued');
    const send = vi.fn(); (feed as any).ws = { readyState: 1, send, close: vi.fn() };
    feed.subscribe(['NSE_FO|52175']);
    expect(send).toHaveBeenCalledWith(expect.any(Buffer), { binary: true });
    expect(JSON.parse(send.mock.calls[0]![0].toString()).data.instrumentKeys).toEqual(['NSE_FO|52175']);
  });

  it('retries when owner OAuth becomes available after startup and disconnects when it expires', async () => {
    let token: any = null;
    feed = new UpstoxMarketFeedService({ config: {} } as any, decoder, gateway as any, { getToken: () => token } as any);
    const authorize = vi.spyOn(feed, 'initiateConnection').mockResolvedValue(undefined);
    await feed.onModuleInit(); authorize.mockClear();
    token = { accessToken: 'new-owner-token', expiresAt: new Date(now + 10000).toISOString() };
    await vi.advanceTimersByTimeAsync(1000);
    expect(authorize).toHaveBeenCalledOnce();
    const close = vi.fn();
    (feed as any).authorizationToken = token.accessToken;
    (feed as any).ws = { readyState: 1, close };
    token.expiresAt = new Date(now - 1).toISOString();
    await vi.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledOnce();
    expect(feed.getFeedHealth().status).toBe(FeedStatus.DISCONNECTED);
  });

  it('fills index cards without a live tick from the delayed REST snapshot and never overwrites live ticks', async () => {
    const token = { accessToken: 'owner-token', expiresAt: new Date(now + 3_600_000).toISOString() };
    feed = new UpstoxMarketFeedService({ config: {} } as any, decoder, gateway as any, { getToken: () => token } as any);
    feed.subscribe(['NSE_INDEX|Nifty 50', 'NSE_INDEX|Nifty Bank', 'NSE_FO|52175']);
    feed.handleBinaryMessage(decoder.encodeMarketFeed(marketPacket()));
    (feed as any).quotes.set('NSE_INDEX|Nifty 50', { ...feed.getQuote('NSE_FO|52175')!, instrumentKey: 'NSE_INDEX|Nifty 50', lastPrice: 25100 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: {
      'NSE_INDEX:Nifty Bank': { instrument_token: 'NSE_INDEX|Nifty Bank', last_price: 56789.5, ohlc: { close: 56500 }, net_change: 289.5, last_trade_time: String(now) },
      'NSE_INDEX:Nifty 50': { instrument_token: 'NSE_INDEX|Nifty 50', last_price: 1, ohlc: { close: 1 } },
    } }) }));
    vi.stubGlobal('fetch', fetchMock);
    await feed.refreshMissingIndexQuotes();
    vi.unstubAllGlobals();
    const requested = new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).searchParams.get('instrument_key');
    expect(requested).toBe('NSE_INDEX|Nifty Bank'); // only indices lacking a live tick
    expect(feed.getQuote('NSE_INDEX|Nifty Bank')).toMatchObject({ lastPrice: 56789.5, provenance: 'DELAYED', isStale: true });
    expect(feed.getQuote('NSE_INDEX|Nifty 50')).toMatchObject({ lastPrice: 25100, provenance: 'LIVE' });
  });

  it('accepts a fresh depth update even when the last trade timestamp did not change', () => {
    feed.handleBinaryMessage(decoder.encodeMarketFeed(marketPacket()));
    feed.handleBinaryMessage(decoder.encodeMarketFeed(marketPacket(now + 1000, now)));
    expect(feed.getFeedHealth().duplicateTicksIgnored).toBe(0);
    feed.handleBinaryMessage(decoder.encodeMarketFeed(marketPacket(now + 1000, now)));
    expect(feed.getFeedHealth().duplicateTicksIgnored).toBe(1);
  });

  it('keeps stale data stale on weekends without converting disconnected status to connected', () => {
    feed.handleBinaryMessage(decoder.encodeMarketFeed(marketPacket()));
    vi.advanceTimersByTime(4000); (feed as any).checkStaleFeed();
    expect(feed.getQuote('NSE_FO|52175')).toMatchObject({ isStale: true, provenance: 'DELAYED' });
    (feed as any).checkStaleFeed();
    expect(feed.getQuote('NSE_FO|52175')?.isStale).toBe(true);
    expect(feed.getFeedHealth().status).toBe(FeedStatus.DISCONNECTED);
  });

  it('labels explicit testing injections SIMULATED and prohibits production injection', () => {
    const quote = decoder.normalizeToQuoteSnapshot(decoder.decodeMarketFeed(decoder.encodeMarketFeed(marketPacket())).feeds['NSE_FO|52175']!);
    feed.injectSimulatedTick(quote);
    expect(feed.getQuote('NSE_FO|52175')?.provenance).toBe('SIMULATED');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => feed.injectSimulatedTick(quote)).toThrow('only to tests');
    vi.unstubAllEnvs();
  });
});
