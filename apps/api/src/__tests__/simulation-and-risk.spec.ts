import { describe, it, expect, beforeEach } from 'vitest';
import {
  RiskReservationManager,
  RiskGateViolationError,
  DuplicateIntentError,
} from '../risk/risk-reservation.manager';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { OrdersService } from '../orders/orders.service';
import { ProposalsService } from '../proposals/proposals.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProtobufDecoderService } from '../market-data/protobuf-decoder.service';
import { EnvService } from '../config/env.service';
import { EventsGateway } from '../websocket/events.gateway';
import { OrderSide, OrderStatus, OrderType, ProductType, AgentType, ProposalStatus } from '@trading-bot/contracts';

describe('Phase 3: Simulation, Risk Engine & Paper Broker', () => {
  let envService: EnvService;
  let decoder: ProtobufDecoderService;
  let gateway: EventsGateway;
  let catalog: InstrumentCatalogService;
  let feed: UpstoxMarketFeedService;
  let reservationManager: RiskReservationManager;
  let broker: PaperBrokerAdapter;
  let proposalsService: ProposalsService;
  let ordersService: OrdersService;

  beforeEach(() => {
    envService = new EnvService();
    decoder = new ProtobufDecoderService();
    gateway = new EventsGateway();
    catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog();
    feed = new UpstoxMarketFeedService(envService, decoder, gateway);
    reservationManager = new RiskReservationManager(envService, gateway);
    broker = new PaperBrokerAdapter(catalog, feed, gateway);
    proposalsService = new ProposalsService(gateway);
    ordersService = new OrdersService(broker, reservationManager, proposalsService, gateway);
  });

  describe('Transactional Capital & Risk Reservations (Zero Double-Spending)', () => {
    it('PROVES: Two agents cannot double-spend capital', () => {
      // Agent 1 acquires reservation for ₹6,000 capital and ₹250 risk
      const res1 = reservationManager.acquireReservation({
        proposalId: 'prop_agent_1',
        signalKey: 'STRAT_1:NIFTY:5m:2026-10-10T09:30:00Z',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        capitalRequired: 6000.0,
        allInRisk: 250.0,
      });

      expect(res1.status).toBe('HELD');
      expect(reservationManager.getAvailableCash()).toBe(4000.0); // 10000 - 6000

      // Agent 2 attempts to reserve ₹5,000 capital (available is only ₹4,000)
      expect(() =>
        reservationManager.acquireReservation({
          proposalId: 'prop_agent_2',
          signalKey: 'STRAT_2:NIFTY:5m:2026-10-10T09:30:00Z',
          instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25150_CE',
          capitalRequired: 5000.0, // Exceeds remaining 4000!
          allInRisk: 250.0,
        }),
      ).toThrow(RiskGateViolationError);

      // Releasing Agent 1's reservation restores available cash
      reservationManager.releaseReservation(res1.id);
      expect(reservationManager.getAvailableCash()).toBe(10000.0);

      // Now Agent 2 can acquire successfully
      const res2 = reservationManager.acquireReservation({
        proposalId: 'prop_agent_2',
        signalKey: 'STRAT_2:NIFTY:5m:2026-10-10T09:30:00Z',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25150_CE',
        capitalRequired: 5000.0,
        allInRisk: 250.0,
      });
      expect(res2.status).toBe('HELD');
    });

    it('rejects duplicate signal intent for the same signal bar', () => {
      const signalKey = 'STRAT_1:NIFTY:5m:2026-10-10T09:45:00Z';

      reservationManager.acquireReservation({
        proposalId: 'prop_001',
        signalKey,
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        capitalRequired: 3000.0,
        allInRisk: 200.0,
      });

      // Attempt duplicate intent with same signalKey
      expect(() =>
        reservationManager.acquireReservation({
          proposalId: 'prop_002',
          signalKey,
          instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
          capitalRequired: 3000.0,
          allInRisk: 200.0,
        }),
      ).toThrow(DuplicateIntentError);
    });

    it('enforces daily drawdown cap: blocks trade when all-in risk exceeds remaining budget', () => {
      // Simulate ₹1,200 loss today out of ₹1,500 daily drawdown cap
      reservationManager.settleClosedPosition('dummy_key', 3000, -1200);

      // Remaining budget is now ₹300 (1500 - 1200)
      expect(reservationManager.getRemainingDailyRiskBudget()).toBe(300.0);

      // Attempting trade with ₹400 risk must be blocked
      expect(() =>
        reservationManager.acquireReservation({
          proposalId: 'prop_risk_test',
          signalKey: 'STRAT_RISK:NIFTY:5m:1000',
          instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
          capitalRequired: 2000.0,
          allInRisk: 400.0, // Exceeds ₹300 remaining
        }),
      ).toThrow(RiskGateViolationError);
    });
  });

  describe('Paper Broker Adapter Execution & Realistic Costing', () => {
    it('STALE FEED GATE: blocks new order when feed quote is missing or stale', async () => {
      // Inject stale quote
      feed.injectSimulatedTick({
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 125.0,
        bidPrice: 124.8,
        askPrice: 125.2,
        bidQty: 250,
        askQty: 300,
        volume: 50000,
        openInterest: 100000,
        timestamp: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago = stale
        isStale: true,
        netChange: 0,
        netChangePct: 0,
      });

      const ack = await broker.placeOrder({
        intentId: 'int_stale_test',
        tag: 'TEST_STALE',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        side: OrderSide.BUY,
        orderType: OrderType.LIMIT,
        product: ProductType.I,
        quantity: 25,
        price: 125.0,
      });

      expect(ack.status).toBe('REJECTED');
      expect(ack.message).toContain('stale feed');
    });

    it('simulates order fill with realistic slippage and statutory charges', async () => {
      // Inject fresh live quote
      feed.injectSimulatedTick({
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 125.0,
        bidPrice: 124.8,
        askPrice: 125.2,
        bidQty: 250,
        askQty: 300,
        volume: 50000,
        openInterest: 100000,
        timestamp: new Date().toISOString(),
        isStale: false,
        netChange: 0,
        netChangePct: 0,
      });

      const ack = await broker.placeOrder({
        intentId: 'int_fresh_test',
        tag: 'TEST_FILL',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        side: OrderSide.BUY,
        orderType: OrderType.LIMIT,
        product: ProductType.I,
        quantity: 25,
        price: 125.5,
      });

      expect(ack.status).toBe('ACKNOWLEDGED');

      // Verify fill logged with actual verified charges
      const fills = broker.getFills();
      expect(fills.length).toBeGreaterThan(0);
      const fill = fills[0]!;
      expect(fill.fillQty).toBe(25);
      expect(fill.fillPrice).toBeCloseTo(125.45, 1); // Ask + 0.25 slippage
      expect(fill.charges.brokerage).toBe(20.0); // One executed buy leg
      expect(fill.actualCharges).toBeGreaterThan(23.0);
    });

    it('handles simulated partial fills and updates order status to PARTIALLY_FILLED', async () => {
      feed.injectSimulatedTick({
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 120.0,
        bidPrice: 119.8,
        askPrice: 120.2,
        bidQty: 250,
        askQty: 300,
        volume: 50000,
        openInterest: 100000,
        timestamp: new Date().toISOString(),
        isStale: false,
        netChange: 0,
        netChangePct: 0,
      });

      // Submit order for 50 units (2 lots) with partial fill flag
      await broker.placeOrder({
        intentId: 'int_partial_test',
        tag: 'TEST_PARTIAL',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        side: OrderSide.BUY,
        orderType: OrderType.LIMIT,
        product: ProductType.I,
        quantity: 50,
        price: 120.5,
        simulatedPartialFill: true,
      });

      const orders = await broker.getOrders();
      const partialOrder = orders.find((o) => o.tag === 'TEST_PARTIAL');
      expect(partialOrder).toBeDefined();
      expect(partialOrder?.status).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(partialOrder?.filledQuantity).toBe(25); // Half filled
    });
  });

  describe('Full End-to-End Proposal Execution Workflow', () => {
    it('executes an approved proposal: reserves capital, fills order, and creates position', async () => {
      feed.injectSimulatedTick({
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        lastPrice: 122.0,
        bidPrice: 121.8,
        askPrice: 122.2,
        bidQty: 250,
        askQty: 300,
        volume: 50000,
        openInterest: 100000,
        timestamp: new Date().toISOString(),
        isStale: false,
        netChange: 0,
        netChangePct: 0,
      });

      // Add and approve a proposal
      const proposal = {
        id: 'prop_e2e_001',
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
          indicators: { closedBars: 40 },
          rationale: 'Confirmed EMA cross',
          confidence: 0.8,
        },
        status: ProposalStatus.APPROVED,
        expiresAt: new Date(Date.now() + 180000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      proposalsService.addProposal(proposal as any);

      const result = await ordersService.executeApprovedProposal(proposal.id);
      expect(result.status).toBe(OrderStatus.FILLED);

      // Verify position created
      const positions = await ordersService.getPositions();
      const pos = positions.find((p) => p.instrumentKey === proposal.instrumentKey);
      expect(pos).toBeDefined();
      expect(pos?.netQuantity).toBe(25);
    });
  });
});
