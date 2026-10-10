import { describe, it, expect } from 'vitest';
import {
  PositionSchema,
  BrokerOrderSchema,
  OrderFillEventSchema,
  ChargeBreakdownSchema,
  RiskStatusSchema,
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
  TradeMode,
  RiskState,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from '@trading-bot/domain';

describe('Trader Client Orders, Fills & Risk Contracts', () => {
  it('validates PositionSchema with GTT stop loss and target bounds', () => {
    const position = {
      id: '550e8400-e29b-41d4-a716-446655440101',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY26OCT25100CE',
      netQuantity: 25,
      buyQuantity: 25,
      sellQuantity: 0,
      buyAvgPrice: 122.5,
      sellAvgPrice: 0,
      lastPrice: 125.8,
      unrealizedPnl: 82.5,
      realizedPnl: 0,
      stopLossPrice: 114.0,
      targetPrice: 136.0,
      lastVerifiedAt: new Date().toISOString(),
    };

    const parsed = PositionSchema.parse(position);
    expect(parsed.netQuantity).toBe(25);
    expect(parsed.stopLossPrice).toBe(114.0);
    expect(parsed.targetPrice).toBe(136.0);
    expect(parsed.unrealizedPnl).toBe(82.5);
  });

  it('validates BrokerOrderSchema across simulated execution transitions', () => {
    const orderPartial = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      intentId: '550e8400-e29b-41d4-a716-446655440002',
      brokerOrderId: 'UPSTOX_SIM_12345',
      tag: 'SIG_1',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      product: ProductType.I,
      quantity: 25,
      price: 122.5,
      status: OrderStatus.PARTIALLY_FILLED,
      filledQuantity: 15,
      averageFillPrice: 123.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = BrokerOrderSchema.parse(orderPartial);
    expect(parsed.status).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(parsed.filledQuantity).toBe(15);
    expect(parsed.quantity).toBe(25);

    const orderRejected = {
      id: '550e8400-e29b-41d4-a716-446655440003',
      intentId: '550e8400-e29b-41d4-a716-446655440004',
      brokerOrderId: null,
      tag: 'SIG_1',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      product: ProductType.I,
      quantity: 25,
      status: OrderStatus.REJECTED,
      filledQuantity: 0,
      averageFillPrice: 0,
      rejectionReason: 'REJECTED_STALE_FEED: Market feed quote age > 3,000ms.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsedRej = BrokerOrderSchema.parse(orderRejected);
    expect(parsedRej.status).toBe(OrderStatus.REJECTED);
    expect(parsedRej.rejectionReason).toContain('REJECTED_STALE_FEED');
  });

  it('validates OrderFillEventSchema and statutory charge calculations', () => {
    const buyPrice = 122.5;
    const sellPrice = 136.0;
    const quantity = 25;

    const domainCharges = calculateOptionCharges({ buyPrice, sellPrice, quantity });
    const parsedCharges = ChargeBreakdownSchema.parse(domainCharges);
    expect(parsedCharges.brokerage).toBe(40.0);
    expect(parsedCharges.stt).toBeGreaterThan(0);
    expect(parsedCharges.totalRoundTripCharges).toBeGreaterThan(45.0);

    const fillEvent = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      orderId: '550e8400-e29b-41d4-a716-446655440001',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      side: OrderSide.BUY,
      fillQty: 25,
      fillPrice: 122.5,
      charges: parsedCharges,
      timestamp: new Date().toISOString(),
      estimatedCharges: 58.2,
      actualCharges: parsedCharges.totalRoundTripCharges,
    };

    const parsedFill = OrderFillEventSchema.parse(fillEvent);
    expect(parsedFill.fillQty).toBe(25);
    expect(parsedFill.actualCharges).toBe(parsedCharges.totalRoundTripCharges);
    expect(parsedFill.estimatedCharges).toBe(58.2);
  });

  it('validates RiskStatusSchema with central capital & drawdown limits', () => {
    const riskStatus = {
      mode: TradeMode.PAPER,
      state: RiskState.ARMED,
      totalCapital: 10000,
      availableCash: 6937.5,
      reservedCapital: 3062.5,
      maxAllInTradeLoss: 500,
      dailyLossCap: 1500,
      realizedNetDailyPnl: 0,
      unrealizedDailyPnl: 82.5,
      remainingDailyRiskBudget: 1417.5,
      openPositionsCount: 1,
      maxOpenPositions: 1,
      dailyTargetProfit: 4000,
      armedUntil: new Date(Date.now() + 3600000).toISOString(),
      killSwitchActive: false,
      egressIpVerified: true,
    };

    const parsed = RiskStatusSchema.parse(riskStatus);
    expect(parsed.mode).toBe(TradeMode.PAPER);
    expect(parsed.reservedCapital).toBe(3062.5);
    expect(parsed.availableCash).toBe(6937.5);
    expect(parsed.totalCapital).toBe(10000);
    expect(parsed.availableCash + parsed.reservedCapital).toBe(parsed.totalCapital);
  });
});
