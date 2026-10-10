import { Controller, Get, Post, Body, Query, Inject } from '@nestjs/common';
import { QuoteSnapshot, OptionChainResult } from '@trading-bot/contracts';
import { getMarketCalendarDetails } from '@trading-bot/domain';
import { UpstoxMarketFeedService, FeedHealthDetails } from '../market-data/upstox-market-feed.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';

@Controller('markets')
export class MarketsController {
  constructor(
    @Inject(UpstoxMarketFeedService) private readonly feedService: UpstoxMarketFeedService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
  ) {}

  @Get('watchlist')
  getWatchlist(): QuoteSnapshot[] {
    return this.feedService.getAllQuotes();
  }

  @Get('options-chain')
  getOptionChain(
    @Query('underlying') underlying = 'NIFTY',
    @Query('expiry') expiry?: string,
  ): OptionChainResult {
    const spotKey = ({ NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank', FINNIFTY: 'NSE_INDEX|Nifty Fin Service', MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT' } as Record<string,string>)[underlying.toUpperCase()] ?? '';
    const spotQuote = this.feedService.getQuote(spotKey);
    const spotPrice = spotQuote && ['LIVE','DELAYED','SIMULATED'].includes(spotQuote.provenance ?? '') ? spotQuote.lastPrice : 0;

    return this.catalog.buildOptionChain(
      underlying,
      expiry,
      spotPrice,
      (key) => {
        const q = this.feedService.getQuote(key);
        if (!q) return undefined;
        return {
          lastPrice: q.lastPrice,
          bidPrice: q.bidPrice,
          askPrice: q.askPrice,
          volume: q.volume,
          openInterest: q.openInterest,
          netChangePct: q.netChangePct || 0,
          isStale: q.isStale,
          provenance: q.provenance,
          depthKnown: q.depthKnown,
          timestamp: q.timestamp,
        };
      },
    );
  }

  @Get('calendar')
  getCalendar() {
    return getMarketCalendarDetails();
  }

  @Get('feed-health')
  getFeedHealth(): FeedHealthDetails {
    return this.feedService.getFeedHealth();
  }

  @Post('subscribe')
  subscribe(@Body('instrumentKeys') keys: string[]) {
    if (Array.isArray(keys) && keys.length > 0) {
      this.feedService.subscribe(keys);
    }
    return { success: true, subscribedCount: keys?.length || 0 };
  }

  @Post('unsubscribe')
  unsubscribe(@Body('instrumentKeys') keys: string[]) {
    if (Array.isArray(keys) && keys.length > 0) {
      this.feedService.unsubscribe(keys);
    }
    return { success: true, unsubscribedCount: keys?.length || 0 };
  }
}
