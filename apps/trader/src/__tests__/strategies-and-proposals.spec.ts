import { describe, it, expect } from 'vitest';
import {
  StrategyConfigSchema,
  TradeProposalSchema,
  AgentTaskSchema,
  AgentType,
  ProposalStatus,
  OrderSide,
  ProductType,
  AutonomousReadinessReportSchema,
  AutonomousArmRequestSchema,
  AutonomousSessionStatusSchema,
  AutonomousExecutionLogSchema,
} from '@trading-bot/contracts';
import { calculateStrategyVersionHash } from '@trading-bot/domain';

describe('Trader Client Strategy & Proposal Contracts', () => {
  it('validates strategy structure and generates FNV-1a version hash for UI', () => {
    const strategy = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      name: 'NIFTY EMA20 RSI Long Call',
      version: 1,
      underlying: 'NIFTY',
      timeframe: '5m',
      entry: {
        emaPeriod: 20,
        rsiPeriod: 14,
        rsiThreshold: 55,
        maxBidAskSpreadPct: 1.0,
        minVolume: 1000,
      },
      selection: {
        expiry: 'NEAREST_ELIGIBLE',
        moneyness: 'ATM' as any,
        minVolume: 1000,
      },
      risk: {
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 200,
        maxAllInDailyLossInr: 600,
        targetNetProfitInr: 300,
      },
    };

    const parsed = StrategyConfigSchema.parse(strategy);
    expect(parsed.name).toBe('NIFTY EMA20 RSI Long Call');
    const hash = calculateStrategyVersionHash(parsed);
    expect(hash).toMatch(/^v1-[0-9a-f]{8}$/);
  });

  it('validates TradeProposal fields displayed on Proposal Inspector', () => {
    const proposal = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY26OCT25100CE',
      side: OrderSide.BUY,
      product: ProductType.I,
      suggestedEntryPrice: 122.5,
      suggestedStopPrice: 114.0,
      suggestedTargetPrice: 136.0,
      lotSize: 25,
      quantity: 25,
      estimatedCapitalRequired: 3062.5,
      estimatedRoundTripCosts: 58.2,
      allInMaxLoss: 270.7,
      estimatedNetProfit: 279.3,
      evidence: {
        indicators: {
          ema20: 25115.0,
          rsi14: 58.4,
          spreadPct: 0.24,
        },
        rationale: '5m EMA bullish cross + RSI above 55 confirmation on closed bar with tight 0.24% spread.',
        confidence: 0.78,
      },
      status: ProposalStatus.PENDING,
      expiresAt: new Date(Date.now() + 180000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const parsed = TradeProposalSchema.parse(proposal);
    expect(parsed.lotSize).toBe(25);
    expect(parsed.allInMaxLoss).toBeLessThanOrEqual(500);
    expect(parsed.estimatedNetProfit).toBeGreaterThan(0);
  });

  it('validates AgentTaskSchema displayed on Agent Task Board', () => {
    const task = {
      id: 'task_1001_coord',
      agentType: AgentType.COORDINATOR,
      status: 'COMPLETED',
      objective: 'Run 5-minute candle close scan for NIFTY EMA20 RSI Strategy v1',
      toolsInvoked: [
        {
          tool: 'scan_universe',
          timestamp: '2026-10-10T09:30:05.120Z',
          input: { underlying: 'NIFTY' },
          output: { candidatesCount: 8 },
        },
      ],
      resultSummary: 'Multi-agent scan satisfied all entry criteria.',
      startedAt: '2026-10-10T09:30:00.000Z',
    };

    const parsed = AgentTaskSchema.parse(task);
    expect(parsed.agentType).toBe(AgentType.COORDINATOR);
    expect(parsed.toolsInvoked.length).toBe(1);
  });

  it('validates Phase 7 AutonomousReadinessReportSchema and items', () => {
    const report = {
      isEligibleForAuto: true,
      evaluatedAt: new Date().toISOString(),
      summary: 'All 6 gates passing',
      items: [
        {
          id: 'auto_01',
          title: 'SEBI Personal Algorithmic Compliance',
          description: 'Supervised personal execution with time bounds',
          category: 'REGULATORY',
          passed: true,
          details: 'SEBI personal API rules satisfied',
          verifiedAt: new Date().toISOString(),
        },
      ],
    };

    const parsed = AutonomousReadinessReportSchema.parse(report);
    expect(parsed.isEligibleForAuto).toBe(true);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].category).toBe('REGULATORY');
  });

  it('validates AutonomousArmRequestSchema and AutonomousSessionStatusSchema', () => {
    const armReq = {
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      windowMinutes: 30,
      maxSessionTrades: 2,
      confirmationCode: 'CONFIRM_AUTO_EXECUTION',
      operatorConsent: true,
    };
    const parsedArm = AutonomousArmRequestSchema.parse(armReq);
    expect(parsedArm.windowMinutes).toBe(30);
    expect(parsedArm.maxSessionTrades).toBe(2);

    const sessionStatus = {
      isArmed: true,
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      strategyName: 'NIFTY EMA20 RSI Long Call',
      strategyVersion: 1,
      versionHash: 'v1-337f4ea9',
      armedAt: new Date().toISOString(),
      armedUntil: new Date(Date.now() + 1800000).toISOString(),
      remainingMinutes: 30,
      maxSessionTrades: 2,
      tradesExecutedInSession: 0,
      lastDisarmReason: null,
      systemMode: 'PAPER' as const,
    };
    const parsedSession = AutonomousSessionStatusSchema.parse(sessionStatus);
    expect(parsedSession.isArmed).toBe(true);
    expect(parsedSession.remainingMinutes).toBe(30);

    const log = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      timestamp: new Date().toISOString(),
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      versionHash: 'v1-337f4ea9',
      action: 'AUTO_TRIGGERED' as const,
      details: 'Strategy armed for 30m window.',
      riskChecksPassed: true,
    };
    const parsedLog = AutonomousExecutionLogSchema.parse(log);
    expect(parsedLog.action).toBe('AUTO_TRIGGERED');
  });
});

