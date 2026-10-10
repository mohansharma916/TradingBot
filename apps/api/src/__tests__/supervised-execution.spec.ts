import { describe, it, expect, beforeEach } from 'vitest';
import { EnvService } from '../config/env.service';
import { SupervisedExecutionService } from '../orders/supervised-execution.service';
import { GoLiveChecklistService } from '../orders/go-live-checklist.service';
import { ProposalsService } from '../proposals/proposals.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { TokenStorageService } from '../broker/token-storage.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { EventsGateway } from '../websocket/events.gateway';
import {
  AgentType,
  OrderStatus,
  OrderSide,
  ProductType,
  ProposalStatus,
  TradeProposal,
  ExitProtectionStatus,
} from '@trading-bot/contracts';

describe('Phase 5: Supervised Live Execution & Protected GTT Exits', () => {
  let envService: EnvService;
  let tokenStorage: TokenStorageService;
  let proposalsService: ProposalsService;
  let paperBroker: PaperBrokerAdapter;
  let upstoxBroker: UpstoxBrokerAdapter;
  let feedService: any;
  let reservationManager: RiskReservationManager;
  let goLiveChecklist: GoLiveChecklistService;
  let executionService: SupervisedExecutionService;
  let gateway: EventsGateway;
  let catalogService: InstrumentCatalogService;

  const validProposal: TradeProposal = {
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
      indicators: { ema20: 25115, rsi14: 58.4, spreadPct: 0.24 },
      rationale: 'Confirmed 5m EMA cross with 0.24% tight spread.',
      confidence: 0.8,
    },
    status: ProposalStatus.APPROVED,
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    envService = new EnvService();
    tokenStorage = new TokenStorageService(envService);
    gateway = new EventsGateway();
    proposalsService = new ProposalsService(gateway);
    catalogService = new InstrumentCatalogService();

    feedService = {
      getQuote: (key: string) => ({
        instrumentKey: key,
        lastPrice: 122.5,
        bidPrice: 122.4,
        askPrice: 122.6,
        isStale: false,
        timestamp: new Date().toISOString(),
      }),
      getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 16 }),
    };

    paperBroker = new PaperBrokerAdapter(catalogService, feedService, gateway);
    upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);
    reservationManager = new RiskReservationManager(envService, gateway);
    goLiveChecklist = new GoLiveChecklistService(envService, tokenStorage);

    executionService = new SupervisedExecutionService(
      envService,
      proposalsService,
      paperBroker,
      upstoxBroker,
      feedService,
      reservationManager,
      goLiveChecklist,
      gateway,
    );

    // Seed proposal
    proposalsService.addProposal({ ...validProposal });
  });

  describe('1. Owner Approval Mode & Freshness Gates', () => {
    it('REJECTS execution if proposal is not explicitly APPROVED by owner', async () => {
      const pendingProposal = {
        ...validProposal,
        id: '550e8400-e29b-41d4-a716-446655440099',
        status: ProposalStatus.PENDING,
      };
      proposalsService.addProposal(pendingProposal);

      await expect(
        executionService.executeSupervisedProposal({
          proposalId: pendingProposal.id,
        }),
      ).rejects.toThrow(/must be APPROVED by owner before supervised execution/i);
    });

    it('REJECTS execution if proposal approval window (180s TTL) has expired', async () => {
      const expiredProposal = {
        ...validProposal,
        id: '550e8400-e29b-41d4-a716-446655440088',
        expiresAt: new Date(Date.now() - 5000).toISOString(), // Expired 5 seconds ago
      };
      proposalsService.addProposal(expiredProposal);

      await expect(
        executionService.executeSupervisedProposal({
          proposalId: expiredProposal.id,
        }),
      ).rejects.toThrow(/approval window has expired/i);
    });
  });

  describe('2. Pre-Trade Revalidation Gates', () => {
    it('REJECTS execution if market quote is stale (> 3,000ms) right before dispatch', async () => {
      feedService.getQuote = () => ({
        instrumentKey: validProposal.instrumentKey,
        lastPrice: 122.5,
        bidPrice: 122.4,
        askPrice: 122.6,
        isStale: true, // Stale!
        timestamp: new Date(Date.now() - 5000).toISOString(),
      });

      await expect(
        executionService.executeSupervisedProposal({
          proposalId: validProposal.id,
          revalidateFreshness: true,
        }),
      ).rejects.toThrow(/exceeds 3,000ms safety threshold/i);
    });

    it('REJECTS execution if spread has widened beyond 1.0% limit right before dispatch', async () => {
      feedService.getQuote = () => ({
        instrumentKey: validProposal.instrumentKey,
        lastPrice: 120.0,
        bidPrice: 118.0,
        askPrice: 122.0, // Spread = (4 / 120) * 100 = 3.33% > 1.0%
        isStale: false,
        timestamp: new Date().toISOString(),
      });

      await expect(
        executionService.executeSupervisedProposal({
          proposalId: validProposal.id,
          revalidateFreshness: true,
        }),
      ).rejects.toThrow(/exceeds 1.0% maximum liquidity ceiling/i);
    });
  });

  describe('3. Supervised Execution with GTT Multi-Leg Protective Exits', () => {
    it('executes entry order, attaches GTT protective exits, and transitions state to PROTECTED', async () => {
      const result = await executionService.executeSupervisedProposal({
        proposalId: validProposal.id,
      });

      expect(result.orderStatus).toBe(OrderStatus.PROTECTED);
      expect(result.protectionStatus).toBe(ExitProtectionStatus.PROTECTED_GTT);
      expect(result.filledQuantity).toBe(25);
      expect(result.averagePrice).toBe(122.5);
      expect(result.gttOrderId).toBeDefined();
      expect(result.message).toContain('protected with GTT Stop');
      expect(result.message).toContain('not a guaranteed stop');

      // Verify open position has protective stop recorded
      const positions = await paperBroker.getPositions();
      const pos = positions.find((p) => p.instrumentKey === validProposal.instrumentKey);
      expect(pos).toBeDefined();
      expect(pos!.stopLossPrice).toBe(114.0);
      expect(pos!.targetPrice).toBe(136.0);
    });
  });

  describe('4. Anomaly Simulation & Failure Injection Drills', () => {
    it('SIMULATES broker request timeout: sets UNKNOWN_BROKER_STATE without assuming fill', async () => {
      const result = await executionService.executeSupervisedProposal({
        proposalId: validProposal.id,
        simulateTimeout: true,
      });

      expect(result.orderStatus).toBe(OrderStatus.UNKNOWN_BROKER_STATE);
      expect(result.protectionStatus).toBe(ExitProtectionStatus.UNPROTECTED);
      expect(result.message).toContain('Simulated request timeout');
    });

    it('SIMULATES protection failure: sets PROTECTION_FAILED and engages Kill Switch freeze', async () => {
      expect(reservationManager.isKillSwitchActive()).toBe(false);

      const result = await executionService.executeSupervisedProposal({
        proposalId: validProposal.id,
        simulateProtectionFailure: true,
      });

      expect(result.orderStatus).toBe(OrderStatus.PROTECTION_FAILED);
      expect(result.protectionStatus).toBe(ExitProtectionStatus.PROTECTION_FAILED);
      expect(result.message).toContain('Protective exit placement failed');

      // Invariant: Kill switch engaged
      expect(reservationManager.isKillSwitchActive()).toBe(true);
    });

    it('SIMULATES uncovered position: warns and halts trading progression', async () => {
      const result = await executionService.executeSupervisedProposal({
        proposalId: validProposal.id,
        simulateUncoveredPosition: true,
      });

      expect(result.orderStatus).toBe(OrderStatus.FILLED);
      expect(result.protectionStatus).toBe(ExitProtectionStatus.UNPROTECTED);
      expect(result.message).toContain('Uncovered position detected');
      expect(reservationManager.isKillSwitchActive()).toBe(true);
    });

    it('SIMULATES exit limit unfilled: sets MANUAL_INTERVENTION_REQUIRED and engages Kill Switch freeze', async () => {
      const result = await executionService.executeSupervisedProposal({
        proposalId: validProposal.id,
        simulateExitLimitUnfilled: true,
      });

      expect(result.orderStatus).toBe(OrderStatus.MANUAL_INTERVENTION_REQUIRED);
      expect(result.protectionStatus).toBe(ExitProtectionStatus.PROTECTION_FAILED);
      expect(result.message).toContain('Protective exit limit order remained UNFILLED');
      expect(reservationManager.isKillSwitchActive()).toBe(true);
    });
  });

  describe('5. Upstox V3 Live Order & GTT Protection Capabilities', () => {
    it('executes Place, Modify, Cancel and GTT Protective Exits via UpstoxBrokerAdapter when armed', async () => {
      tokenStorage.storeToken({
        accessToken: 'mock_upstox_access_token_123',
        expiresInSeconds: 3600,
        userId: 'USER_101',
        userType: 'individual',
      });
      (envService.config as any).LIVE_EXECUTION_ENABLED = true;

      // Place Order
      const ack = await upstoxBroker.placeOrder({
        instrumentKey: validProposal.instrumentKey,
        quantity: 25,
        price: 122.5,
        side: OrderSide.BUY,
        product: ProductType.I,
        tag: 'LIVE_SUP_1',
      });
      expect(ack.status).toBe('ACKNOWLEDGED');
      expect(ack.orderId).toBeDefined();

      // Modify Order
      const modAck = await upstoxBroker.modifyOrder({
        orderId: ack.orderId,
        quantity: 25,
        price: 124.0,
      });
      expect(modAck.status).toBe('ACKNOWLEDGED');

      // Cancel Order
      await expect(upstoxBroker.cancelOrder(ack.orderId)).resolves.not.toThrow();

      // Place Protective GTT Multi-Leg Exits
      const protRes = await upstoxBroker.placeProtectiveExit({
        instrumentKey: validProposal.instrumentKey,
        quantity: 25,
        stopLossPrice: 114.0,
        targetPrice: 136.0,
        product: ProductType.I,
      });
      expect(protRes.success).toBe(true);
      expect(protRes.protectionStatus).toBe(ExitProtectionStatus.PROTECTED_GTT);
      expect(protRes.stopLossPrice).toBe(114.0);
      expect(protRes.targetPrice).toBe(136.0);
      expect(protRes.message).toContain('not a guaranteed stop');
    });
  });

  describe('6. Go-Live Safety Checklist Service', () => {
    it('initializes 10 mandatory pre-flight checklist items and verifies completeness', () => {
      const checklist = goLiveChecklist.getChecklist();
      expect(checklist.items.length).toBe(10);
      expect(checklist.allPassed).toBe(false); // Token is unconfigured by default
      expect(checklist.liveExecutionPermitted).toBe(false);
    });

    it('permits live execution only after all items pass, owner signs off, and flag is enabled', () => {
      // Simulate stored token to pass auth check
      tokenStorage.storeToken({
        accessToken: 'test_token',
        expiresInSeconds: 3600,
        userId: 'USER_101',
        userType: 'individual',
      });

      // Enable live execution feature flag
      (envService.config as any).LIVE_EXECUTION_ENABLED = true;

      // Sign off checklist
      const updated = goLiveChecklist.completeChecklist('Platform Owner John');
      expect(updated.allPassed).toBe(true);
      expect(updated.signedOffBy).toBe('Platform Owner John');
      expect(updated.signedOffAt).not.toBeNull();
      expect(updated.liveExecutionPermitted).toBe(true);
    });
  });
});
