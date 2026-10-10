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
  ExitProtectionStatus,
  GTTRuleSchema,
  ProtectionResultSchema,
  GoLiveChecklistSchema,
  SupervisedExecutionRequestSchema,
  SupervisedExecutionResultSchema,
  FlattenPositionsResultSchema,
  SystemAlertSchema,
  DiagnosticsReportSchema,
  ReconciliationScheduleStatusSchema,
  AlertSeverity,
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

  describe('Phase 5: Supervised Live Execution & GTT Protection Contracts', () => {
    it('validates GTT multi-leg exit rules and protection results', () => {
      const stopRule = {
        type: 'STOPLOSS' as const,
        triggerPrice: 114.0,
        price: 113.5,
        quantity: 25,
      };
      const parsedStop = GTTRuleSchema.parse(stopRule);
      expect(parsedStop.triggerPrice).toBe(114.0);
      expect(parsedStop.price).toBe(113.5);

      const protectionResult = {
        success: true,
        protectionStatus: ExitProtectionStatus.PROTECTED_GTT,
        gttOrderId: 'gtt_multi_9901',
        stopLossPrice: 114.0,
        targetPrice: 136.0,
        confirmedQty: 25,
        message: 'GTT protection attached. Limit order trigger; not a guaranteed stop.',
      };
      const parsedProtection = ProtectionResultSchema.parse(protectionResult);
      expect(parsedProtection.protectionStatus).toBe(ExitProtectionStatus.PROTECTED_GTT);
      expect(parsedProtection.message).toContain('not a guaranteed stop');
    });

    it('validates Go-Live 10-Item Checklist Schema', () => {
      const now = new Date().toISOString();
      const checklist = {
        allPassed: true,
        items: [
          { id: 'chk_01', category: 'REGULATORY' as const, title: 'SEBI Compliance', description: 'Supervised personal execution verified', passed: true, verifiedAt: now },
          { id: 'chk_02', category: 'INFRASTRUCTURE' as const, title: 'Static IP', description: 'Egress IP matched against broker whitelist', passed: true, verifiedAt: now },
          { id: 'chk_03', category: 'RISK_CAPS' as const, title: 'Hard Caps', description: 'Capital ₹10,000 and ₹500 trade risk enforced', passed: true, verifiedAt: now },
          { id: 'chk_04', category: 'BROKER_OAUTH' as const, title: 'OAuth AES Token', description: 'AES-256-GCM encrypted token active', passed: true, verifiedAt: now },
          { id: 'chk_05', category: 'MARKET_DATA' as const, title: 'Feed Freshness', description: 'Quote latency < 3,000ms gate verified', passed: true, verifiedAt: now },
          { id: 'chk_06', category: 'MARKET_DATA' as const, title: 'Spread Filter', description: 'Max bid-ask spread <= 1.0% operational', passed: true, verifiedAt: now },
          { id: 'chk_07', category: 'PROTECTION_MECHANISM' as const, title: 'GTT Exits', description: 'Multi-leg Entry, Target, Stop exits active', passed: true, verifiedAt: now },
          { id: 'chk_08', category: 'PROTECTION_MECHANISM' as const, title: 'Kill Switch', description: 'Protection failure triggers kill switch', passed: true, verifiedAt: now },
          { id: 'chk_09', category: 'INFRASTRUCTURE' as const, title: 'Single Lock', description: 'Single in-flight intent lock active', passed: true, verifiedAt: now },
          { id: 'chk_10', category: 'CONSENT' as const, title: 'Manual Sign-Off', description: 'Platform owner affirmative authorization', passed: true, verifiedAt: now },
        ],
        signedOffBy: 'Platform Owner John',
        signedOffAt: now,
        liveExecutionPermitted: true,
      };

      const parsed = GoLiveChecklistSchema.parse(checklist);
      expect(parsed.items).toHaveLength(10);
      expect(parsed.allPassed).toBe(true);
      expect(parsed.liveExecutionPermitted).toBe(true);
    });

    it('validates SupervisedExecutionRequest and Result schemas', () => {
      const req = {
        proposalId: '550e8400-e29b-41d4-a716-446655440001',
        revalidateFreshness: true,
      };
      const parsedReq = SupervisedExecutionRequestSchema.parse(req);
      expect(parsedReq.proposalId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(parsedReq.revalidateFreshness).toBe(true);

      const res = {
        orderId: 'ord_sup_12345',
        intentId: '550e8400-e29b-41d4-a716-446655440002',
        orderStatus: OrderStatus.PROTECTED,
        protectionStatus: ExitProtectionStatus.PROTECTED_GTT,
        filledQuantity: 25,
        averagePrice: 122.5,
        gttOrderId: 'gtt_tgt_123',
        message: 'Order filled and GTT protective exits armed.',
      };
      const parsedRes = SupervisedExecutionResultSchema.parse(res);
      expect(parsedRes.orderStatus).toBe(OrderStatus.PROTECTED);
      expect(parsedRes.protectionStatus).toBe(ExitProtectionStatus.PROTECTED_GTT);
      expect(parsedRes.filledQuantity).toBe(25);
    });
  });

  describe('Phase 6 Operational Resilience & Diagnostics Contracts', () => {
    it('validates FlattenPositionsResultSchema', () => {
      const flattenResult = {
        success: true,
        positionsClosed: 1,
        exitOrders: [
          {
            orderId: 'ord_flat_01',
            instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
            symbol: 'NIFTY 25100 CE',
            quantity: 25,
            exitPrice: 125.75,
            realizedPnl: 45.83,
            charges: 52.22,
            status: OrderStatus.CLOSED,
          },
        ],
        totalRealizedNetPnl: 45.83,
        totalActualCharges: 52.22,
        message: 'Flattened 1 position(s). System DISARMED.',
      };

      const parsed = FlattenPositionsResultSchema.parse(flattenResult);
      expect(parsed.success).toBe(true);
      expect(parsed.positionsClosed).toBe(1);
      expect(parsed.exitOrders).toHaveLength(1);
      expect(parsed.exitOrders[0]!.status).toBe(OrderStatus.CLOSED);
      expect(parsed.disclaimer).toContain('confirmed broker fill');
    });

    it('validates SystemAlertSchema and AlertSeverity', () => {
      const alert = {
        id: '550e8400-e29b-41d4-a716-446655440099',
        severity: AlertSeverity.CRITICAL,
        category: 'RECONCILIATION' as const,
        title: 'Discrepancy Detected',
        message: 'Phantom position detected on Upstox broker.',
        acknowledged: false,
        timestamp: new Date().toISOString(),
      };

      const parsed = SystemAlertSchema.parse(alert);
      expect(parsed.severity).toBe(AlertSeverity.CRITICAL);
      expect(parsed.category).toBe('RECONCILIATION');
      expect(parsed.acknowledged).toBe(false);
    });

    it('validates DiagnosticsReportSchema and ReconciliationScheduleStatusSchema', () => {
      const scheduleStatus = {
        schedulerActive: true,
        intervalSeconds: 60,
        lastRunAt: new Date().toISOString(),
        totalRuns: 25,
        lastDiscrepanciesFound: 0,
      };
      const parsedSchedule = ReconciliationScheduleStatusSchema.parse(scheduleStatus);
      expect(parsedSchedule.schedulerActive).toBe(true);
      expect(parsedSchedule.intervalSeconds).toBe(60);

      const diag = {
        uptimeSeconds: 3600,
        memoryUsageMb: 78.5,
        systemMode: 'PAPER' as const,
        marketFeed: {
          connected: true,
          latencyMs: 14,
          staleTicksCount: 0,
          lastTickAt: new Date().toISOString(),
        },
        brokerConnection: {
          authenticated: true,
          rateLimiterTokensRemaining: 25,
          egressIpMatch: true,
          registeredIp: '127.0.0.1',
          tokenExpiresInSeconds: 86400,
        },
        riskStatus: {
          killSwitchActive: false,
          riskState: RiskState.DISARMED,
          availableCash: 10000,
          reservedCapital: 0,
          dailyDrawdownBudgetRemaining: 1500,
          openPositionsCount: 0,
        },
        reconciliation: {
          activeScheduler: true,
          lastReconciliationAt: new Date().toISOString(),
          discrepancyCount: 0,
        },
        timestamp: new Date().toISOString(),
      };
      const parsedDiag = DiagnosticsReportSchema.parse(diag);
      expect(parsedDiag.systemMode).toBe('PAPER');
      expect(parsedDiag.marketFeed.connected).toBe(true);
      expect(parsedDiag.riskStatus.riskState).toBe(RiskState.DISARMED);
    });
  });
});


