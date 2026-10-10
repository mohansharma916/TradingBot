import { describe, it, expect } from 'vitest';
import {
  TradeMode,
  RiskState,
  TradeProposalSchema,
  StrategyConfigSchema,
  RiskStatusSchema,
  InstrumentSchema,
  InstrumentType,
  AgentType,
  OrderSide,
  ProductType,
} from '../index.ts';

describe('Contracts & Schemas', () => {
  it('validates TradeProposal correctly', () => {
    const validProposal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      strategyId: '550e8400-e29b-41d4-a716-446655440001',
      strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: 'NSE_FO|52175',
      symbol: 'NIFTY26OCT25000CE',
      side: OrderSide.BUY,
      product: ProductType.I,
      suggestedEntryPrice: 120.5,
      suggestedStopPrice: 112.5,
      suggestedTargetPrice: 135.0,
      lotSize: 25,
      quantity: 25,
      estimatedCapitalRequired: 3012.5,
      estimatedRoundTripCosts: 58.4,
      allInMaxLoss: 258.4,
      estimatedNetProfit: 304.1,
      evidence: {
        indicators: {
          ema20: 25010,
          rsi14: 61.5,
        },
        rationale: '5-minute EMA breakout confirmed by RSI > 55',
        confidence: 0.82,
      },
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const parsed = TradeProposalSchema.safeParse(validProposal);
    expect(parsed.success).toBe(true);
  });

  it('rejects proposal with invalid confidence or negative prices', () => {
    const invalidProposal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      suggestedEntryPrice: -10,
    };
    const parsed = TradeProposalSchema.safeParse(invalidProposal);
    expect(parsed.success).toBe(false);
  });

  it('enforces RiskStatus schema structure', () => {
    const status = {
      mode: TradeMode.PAPER,
      state: RiskState.DISARMED,
      totalCapital: 10000,
      availableCash: 9500,
      reservedCapital: 500,
      maxAllInTradeLoss: 500,
      dailyLossCap: 1500,
      realizedNetDailyPnl: -120,
      unrealizedDailyPnl: 45,
      remainingDailyRiskBudget: 1380,
      openPositionsCount: 1,
      maxOpenPositions: 1,
      dailyTargetProfit: 4000,
      armedUntil: null,
      killSwitchActive: false,
      egressIpVerified: true,
    };

    const parsed = RiskStatusSchema.safeParse(status);
    expect(parsed.success).toBe(true);
  });
});
