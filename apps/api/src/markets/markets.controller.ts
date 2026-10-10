import { Controller, Get, Query } from '@nestjs/common';
import { QuoteSnapshot } from '@trading-bot/contracts';

@Controller('markets')
export class MarketsController {
  @Get('watchlist')
  getWatchlist(): QuoteSnapshot[] {
    const now = new Date().toISOString();
    return [
      {
        instrumentKey: 'NSE_INDEX|Nifty 50',
        lastPrice: 25120.45,
        bidPrice: 25120.1,
        askPrice: 25120.8,
        bidQty: 500,
        askQty: 625,
        volume: 8452000,
        openInterest: 0,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_INDEX|Nifty Bank',
        lastPrice: 52450.8,
        bidPrice: 25449.5,
        askPrice: 52451.2,
        bidQty: 300,
        askQty: 450,
        volume: 4120000,
        openInterest: 0,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_FO|52175',
        lastPrice: 124.5,
        bidPrice: 124.2,
        askPrice: 124.8,
        bidQty: 125,
        askQty: 150,
        volume: 98500,
        openInterest: 142000,
        timestamp: now,
        isStale: false,
      },
      {
        instrumentKey: 'NSE_FO|52176',
        lastPrice: 98.2,
        bidPrice: 97.9,
        askPrice: 98.5,
        bidQty: 100,
        askQty: 125,
        volume: 76000,
        openInterest: 110500,
        timestamp: now,
        isStale: false,
      },
    ];
  }

  @Get('options-chain')
  getOptionChain(@Query('underlying') underlying = 'NIFTY') {
    const spot = underlying === 'BANKNIFTY' ? 52450 : 25120;
    const strikes = [spot - 100, spot - 50, spot, spot + 50, spot + 100];

    return {
      underlying,
      spotPrice: spot,
      expiryDate: '2026-10-15',
      chain: strikes.map((strike) => ({
        strike,
        call: {
          instrumentKey: `NSE_FO|${underlying}_${strike}_CE`,
          lastPrice: Math.max(10, Math.round(150 - (strike - spot) * 0.5)),
          bidPrice: Math.max(9, Math.round(149 - (strike - spot) * 0.5)),
          askPrice: Math.max(11, Math.round(151 - (strike - spot) * 0.5)),
          openInterest: 45000,
        },
        put: {
          instrumentKey: `NSE_FO|${underlying}_${strike}_PE`,
          lastPrice: Math.max(10, Math.round(150 + (strike - spot) * 0.5)),
          bidPrice: Math.max(9, Math.round(149 + (strike - spot) * 0.5)),
          askPrice: Math.max(11, Math.round(151 + (strike - spot) * 0.5)),
          openInterest: 38000,
        },
      })),
    };
  }
}
