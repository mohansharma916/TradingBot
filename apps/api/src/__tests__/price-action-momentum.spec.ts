import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { PriceActionMomentumService } from '../strategies/price-action-momentum.service';
import { Candle } from '@trading-bot/domain';
import { InstrumentType, OrderSide } from '@trading-bot/contracts';

describe('PriceActionMomentumService NestJS Integration Tests', () => {
  const mockProposalsService = {
    addProposal: vi.fn(),
  } as any;

  const mockRiskService = {
    getStatus: vi.fn().mockReturnValue({ state: 'ARMED' }),
  } as any;

  const mockCatalogService = {
    searchInstruments: vi.fn().mockResolvedValue([
      {
        instrumentKey: 'NSE_FO|12345',
        symbol: 'NIFTY26MAR22100CE',
        underlying: 'NIFTY',
        instrumentType: InstrumentType.CE,
        lotSize: 65,
        strikePrice: 22100,
        tickSize: 0.05,
      },
      {
        instrumentKey: 'NSE_FO|12346',
        symbol: 'NIFTY26MAR22100PE',
        underlying: 'NIFTY',
        instrumentType: InstrumentType.PE,
        lotSize: 65,
        strikePrice: 22100,
        tickSize: 0.05,
      },
    ]),
  } as any;

  function createBullishCandles(): Candle[] {
    return [
      { timestamp: '2026-03-02T09:15:00.000Z', open: 22000, high: 22020, low: 21990, close: 22010, volume: 1500 },
      { timestamp: '2026-03-02T09:16:00.000Z', open: 22010, high: 22035, low: 22005, close: 22030, volume: 1600 },
      { timestamp: '2026-03-02T09:17:00.000Z', open: 22030, high: 22055, low: 22025, close: 22050, volume: 1800 },
      { timestamp: '2026-03-02T09:18:00.000Z', open: 22050, high: 22070, low: 22045, close: 22065, volume: 1400 },
      { timestamp: '2026-03-02T09:19:00.000Z', open: 22065, high: 22090, low: 22060, close: 22085, volume: 2000 },
      { timestamp: '2026-03-02T09:20:00.000Z', open: 22085, high: 22110, low: 22080, close: 22105, volume: 2200 },
    ];
  }

  it('evaluates signal cleanly and emits BUY_CE when breakout occurs', () => {
    const service = new PriceActionMomentumService(
      mockProposalsService,
      mockRiskService,
      mockCatalogService,
    );

    const candles = createBullishCandles();
    const livePrice = 22115; // > 22110

    const result = service.evaluateSignal(candles, livePrice);
    expect(result.signal).toBe('BUY_CE');
    expect(result.direction).toBe('BULLISH');
    expect(result.trendEfficiency).toBe(1.0);
  });

  it('generates and adds a TradeProposal when signal triggers and risk gates pass', async () => {
    const service = new PriceActionMomentumService(
      mockProposalsService,
      mockRiskService,
      mockCatalogService,
    );

    const candles = createBullishCandles();
    const livePrice = 22115;

    const proposal = await service.generateProposalIfTriggered(
      candles,
      livePrice,
      'test-strategy-id',
      1,
    );

    expect(proposal).not.toBeNull();
    expect(proposal?.side).toBe(OrderSide.BUY);
    expect(proposal?.symbol).toContain('NIFTY');
    expect(proposal?.lotSize).toBe(65);
    expect(mockProposalsService.addProposal).toHaveBeenCalledWith(proposal);
  });

  it('runs parameter sweep optimization across candle windows and thresholds', () => {
    const service = new PriceActionMomentumService(
      mockProposalsService,
      mockRiskService,
      mockCatalogService,
    );

    const candles: Candle[] = [];
    const baseTime = Date.parse('2026-03-02T09:15:00.000Z');
    let close = 22000;
    for (let i = 0; i < 40; i++) {
      const step = i < 20 ? 8 : -6;
      close += step;
      candles.push({
        timestamp: new Date(baseTime + i * 60000).toISOString(),
        open: close - step,
        high: close + 4,
        low: close - 4,
        close,
        volume: 1200,
      });
    }

    const optimization = service.runParameterOptimization(candles);
    expect(optimization.length).toBeGreaterThan(0);
    expect(optimization[0]).toHaveProperty('candleCount');
    expect(optimization[0]).toHaveProperty('minimumEfficiency');
    expect(optimization[0]).toHaveProperty('winRatePct');
    expect(optimization[0]).toHaveProperty('inSample');
    expect(optimization[0]).toHaveProperty('outOfSample');
    expect(optimization[0]).toHaveProperty('degradationRatio');
  });

  it('B30: bounds optimization dataset rejecting oversized candle inputs', () => {
    const service = new PriceActionMomentumService(
      mockProposalsService,
      mockRiskService,
      mockCatalogService,
    );
    const fakeBar = {
      timestamp: '2026-03-02T09:15:00.000Z',
      open: 22000,
      high: 22010,
      low: 21990,
      close: 22005,
      volume: 1000,
    };
    const oversized = new Array(10001).fill(fakeBar);
    expect(() => service.runParameterOptimization(oversized)).toThrow('10,000 candles');
  });
});
