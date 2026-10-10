import { Injectable, OnModuleInit } from '@nestjs/common';
import protobuf from 'protobufjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuoteSnapshot, MarketDepth } from '@trading-bot/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DecodedFeedItem {
  instrumentKey: string;
  lastPrice: number;
  closePrice: number;
  lastTradeTime: number;
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
  type: 'initial_feed' | 'live_feed';
  currentTs: number;
  feeds: Record<string, DecodedFeedItem>;
}

@Injectable()
export class ProtobufDecoderService implements OnModuleInit {
  private root: protobuf.Root | null = null;
  private FeedResponseType: protobuf.Type | null = null;

  async onModuleInit() {
    await this.loadProto();
  }

  public async loadProto(): Promise<void> {
    const protoPath = path.resolve(__dirname, 'proto/MarketDataFeed.proto');
    this.root = await protobuf.load(protoPath);
    this.FeedResponseType = this.root.lookupType('com.upstox.marketdatafeeder.rpc.proto.FeedResponse');
  }

  public decodeMarketFeed(buffer: Uint8Array | Buffer): DecodedFeedResponse {
    if (!this.FeedResponseType) {
      throw new Error('Protobuf root not loaded yet. Call loadProto() first.');
    }

    const message = this.FeedResponseType.decode(buffer);
    const object = this.FeedResponseType.toObject(message, {
      longs: Number,
      enums: String,
      bytes: String,
      defaults: true,
      arrays: true,
      objects: true,
    }) as any;

    const feeds: Record<string, DecodedFeedItem> = {};

    if (object.feeds) {
      for (const [key, feedUnion] of Object.entries<any>(object.feeds)) {
        if (feedUnion.fullFeed) {
          const ff = feedUnion.fullFeed;
          const ltp = Number(ff.ltp || 0);
          const cp = Number(ff.cp || 0);
          const change = ff.change !== undefined ? Number(ff.change) : ltp - cp;
          const changePct = cp > 0 ? Number(((change / cp) * 100).toFixed(2)) : 0;

          const bids = (ff.marketLevel?.bidAskQuote || [])
            .filter((q: any) => q.bp > 0)
            .slice(0, 5)
            .map((q: any) => ({
              price: Number(q.bp || 0),
              quantity: Number(q.bq || 0),
              orders: Number(q.bOrders || q.b_orders || 0),
            }));

          const asks = (ff.marketLevel?.bidAskQuote || [])
            .filter((q: any) => q.ap > 0)
            .slice(0, 5)
            .map((q: any) => ({
              price: Number(q.ap || 0),
              quantity: Number(q.aq || 0),
              orders: Number(q.aOrders || q.a_orders || 0),
            }));

          feeds[key] = {
            instrumentKey: key,
            lastPrice: ltp,
            closePrice: cp,
            lastTradeTime: Number(ff.ltt || Date.now()),
            lastTradeQty: Number(ff.ltq || 0),
            netChange: Number(change.toFixed(2)),
            netChangePct: changePct,
            openPrice: ff.marketOHLC?.open ? Number(ff.marketOHLC.open) : undefined,
            highPrice: ff.marketOHLC?.high ? Number(ff.marketOHLC.high) : undefined,
            lowPrice: ff.marketOHLC?.low ? Number(ff.marketOHLC.low) : undefined,
            volume: Number(ff.vtt || 0),
            openInterest: Number(ff.oi || 0),
            depth: { bids, asks },
          };
        } else if (feedUnion.ltpc) {
          const ltpc = feedUnion.ltpc;
          const ltp = Number(ltpc.ltp || 0);
          const cp = Number(ltpc.cp || 0);
          const change = ltp - cp;
          const changePct = cp > 0 ? Number(((change / cp) * 100).toFixed(2)) : 0;

          feeds[key] = {
            instrumentKey: key,
            lastPrice: ltp,
            closePrice: cp,
            lastTradeTime: Number(ltpc.ltt || Date.now()),
            lastTradeQty: Number(ltpc.ltq || 0),
            netChange: Number(change.toFixed(2)),
            netChangePct: changePct,
          };
        }
      }
    }

    return {
      type: object.type === 0 || object.type === 'initial_feed' ? 'initial_feed' : 'live_feed',
      currentTs: Number(object.currentTs || Date.now()),
      feeds,
    };
  }

  public normalizeToQuoteSnapshot(item: DecodedFeedItem, isStale = false): QuoteSnapshot {
    const bestBid = item.depth?.bids[0];
    const bestAsk = item.depth?.asks[0];

    return {
      instrumentKey: item.instrumentKey,
      lastPrice: item.lastPrice,
      bidPrice: bestBid ? bestBid.price : item.lastPrice,
      askPrice: bestAsk ? bestAsk.price : item.lastPrice,
      bidQty: bestBid ? bestBid.quantity : 0,
      askQty: bestAsk ? bestAsk.quantity : 0,
      volume: item.volume || 0,
      openInterest: item.openInterest || 0,
      timestamp: new Date(item.lastTradeTime || Date.now()).toISOString(),
      isStale,
      netChange: item.netChange,
      netChangePct: item.netChangePct,
      openPrice: item.openPrice,
      highPrice: item.highPrice,
      lowPrice: item.lowPrice,
      closePrice: item.closePrice,
      depth: item.depth,
    };
  }

  public encodeMarketFeed(payload: any): Uint8Array {
    if (!this.FeedResponseType) {
      throw new Error('Protobuf root not loaded yet. Call loadProto() first.');
    }
    const errMsg = this.FeedResponseType.verify(payload);
    if (errMsg) throw Error(errMsg);
    const message = this.FeedResponseType.create(payload);
    return this.FeedResponseType.encode(message).finish();
  }
}
