import { Injectable, OnModuleInit } from '@nestjs/common';
import protobuf from 'protobufjs';
import path from 'node:path';
import { QuoteSnapshot, MarketDepth } from '@trading-bot/contracts';

const positive = (value: unknown): number => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const nonnegative = (value: unknown): number => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export interface DecodedFeedItem {
  instrumentKey: string;
  lastPrice: number;
  closePrice: number;
  lastTradeTime: number;
  eventTime: number;
  lastTradeQty: number;
  netChange: number;
  netChangePct: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  volume?: number;
  openInterest?: number;
  depth?: MarketDepth;
}

export interface DecodedFeedResponse {
  type: 'initial_feed' | 'live_feed' | 'market_info';
  currentTs: number;
  feeds: Record<string, DecodedFeedItem>;
  marketInfo?: { segmentStatus?: Record<string, string> };
}

@Injectable()
export class ProtobufDecoderService implements OnModuleInit {
  private FeedResponseType: protobuf.Type | null = null;

  async onModuleInit() { await this.loadProto(); }

  public async loadProto(): Promise<void> {
    const root = await protobuf.load(path.resolve(__dirname, 'proto/MarketDataFeed.proto'));
    this.FeedResponseType = root.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
  }

  public decodeMarketFeed(buffer: Uint8Array | Buffer): DecodedFeedResponse {
    if (!this.FeedResponseType) throw new Error('Protobuf decoder is not initialized.');
    const message = this.FeedResponseType.decode(buffer);
    const object = this.FeedResponseType.toObject(message, { longs: Number, enums: String, defaults: false }) as any;
    const currentTs = positive(object.currentTs);
    const feeds: Record<string, DecodedFeedItem> = {};
    for (const [key, union] of Object.entries<any>(object.feeds || {})) {
      const full = union.fullFeed?.marketFF || union.fullFeed?.indexFF || union.firstLevelWithGreeks;
      const ltpc = full?.ltpc || union.ltpc;
      if (!ltpc || positive(ltpc.ltp) === 0) continue;
      const lastPrice = positive(ltpc.ltp);
      const closePrice = positive(ltpc.cp);
      const depthRows = full?.marketLevel?.bidAskQuote || (union.firstLevelWithGreeks?.firstDepth ? [union.firstLevelWithGreeks.firstDepth] : []);
      const bids = depthRows.filter((q: any) => positive(q.bidP) && positive(q.bidQ)).slice(0, 5)
        .map((q: any) => ({ price: positive(q.bidP), quantity: Math.floor(positive(q.bidQ)) }));
      const asks = depthRows.filter((q: any) => positive(q.askP) && positive(q.askQ)).slice(0, 5)
        .map((q: any) => ({ price: positive(q.askP), quantity: Math.floor(positive(q.askQ)) }));
      const daily = full?.marketOHLC?.ohlc?.find((bar: any) => bar.interval === '1d');
      const netChange = lastPrice - closePrice;
      feeds[key] = {
        instrumentKey: key, lastPrice, closePrice,
        lastTradeTime: positive(ltpc.ltt), eventTime: currentTs,
        lastTradeQty: Math.floor(nonnegative(ltpc.ltq)),
        netChange: Number(netChange.toFixed(2)), netChangePct: closePrice > 0 ? Number((netChange / closePrice * 100).toFixed(2)) : 0,
        volume: Math.floor(nonnegative(full?.vtt ?? daily?.vol)), openInterest: Math.floor(nonnegative(full?.oi)),
        openPrice: daily ? nonnegative(daily.open) : undefined,
        highPrice: daily ? nonnegative(daily.high) : undefined,
        lowPrice: daily ? nonnegative(daily.low) : undefined,
        depth: bids.length || asks.length ? { bids, asks } : undefined,
      };
    }
    return { type: object.type === 'market_info' ? 'market_info' : object.type === 'initial_feed' ? 'initial_feed' : 'live_feed', currentTs, feeds, marketInfo: object.marketInfo };
  }

  public normalizeToQuoteSnapshot(item: DecodedFeedItem, isStale = false,
    provenance: 'LIVE' | 'DELAYED' | 'SIMULATED' | 'UNAVAILABLE' = 'LIVE', receivedAt = new Date().toISOString()): QuoteSnapshot {
    const bid = item.depth?.bids[0];
    const ask = item.depth?.asks[0];
    const sourceTimestamp = item.eventTime || item.lastTradeTime;
    const timestamp = new Date(sourceTimestamp > 0 ? sourceTimestamp : 0).toISOString();
    const age = Date.parse(receivedAt) - Date.parse(timestamp);
    const unavailable = sourceTimestamp <= 0 || !Number.isFinite(age);
    const stale = isStale || unavailable || age < -1000 || age > 3000 || provenance === 'UNAVAILABLE' || provenance === 'DELAYED';
    return {
      instrumentKey: item.instrumentKey, lastPrice: item.lastPrice,
      bidPrice: bid?.price || 0, askPrice: ask?.price || 0, bidQty: bid?.quantity || 0, askQty: ask?.quantity || 0,
      volume: item.volume || 0, openInterest: item.openInterest || 0,
      timestamp, receivedAt, provenance: unavailable ? 'UNAVAILABLE' : stale && provenance === 'LIVE' ? 'DELAYED' : provenance,
      depthKnown: !!bid && !!ask && ask.price >= bid.price && bid.quantity > 0 && ask.quantity > 0,
      isStale: stale, netChange: item.netChange, netChangePct: item.netChangePct,
      openPrice: item.openPrice, highPrice: item.highPrice, lowPrice: item.lowPrice, closePrice: item.closePrice, depth: item.depth,
    };
  }

  /** Test packet encoding uses the vendored official V3 schema. */
  public encodeMarketFeed(payload: any): Uint8Array {
    if (!this.FeedResponseType) throw new Error('Protobuf decoder is not initialized.');
    const error = this.FeedResponseType.verify(payload);
    if (error) throw new Error(error);
    return this.FeedResponseType.encode(this.FeedResponseType.create(payload)).finish();
  }
}
