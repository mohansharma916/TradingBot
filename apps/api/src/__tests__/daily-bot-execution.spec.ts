import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DailyBotConfig, DailyBotConfigSchema, DailyBotSession, OrderSide, OrderType, ProductType,
  QuoteSnapshot, TradeMode, StrategyStatus,
} from '@trading-bot/contracts';
import { calculateOptionCharges, Candle } from '@trading-bot/domain';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { AgentToolsService } from '../agents/agent-tools.service';
import { MarketScannerAgent } from '../agents/market-scanner.agent';
import { StrategyAnalystAgent } from '../agents/strategy-analyst.agent';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { EnvService } from '../config/env.service';
import { DailyBotExecutionService } from '../daily-bot/daily-bot-execution.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { ProtobufDecoderService } from '../market-data/protobuf-decoder.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskGateViolationError, RiskReservationManager } from '../risk/risk-reservation.manager';
import { OrdersService } from '../orders/orders.service';
import { RiskService } from '../risk/risk.service';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { ReconciliationSchedulerService } from '../broker/reconciliation-scheduler.service';
import { StrategiesService } from '../strategies/strategies.service';

describe('Daily Bot execution and protective lifecycle', () => {
  const optionKey = 'NSE_FO|51001';
  const brokerRecords = [{ segment: 'NSE_FO', instrument_key: optionKey, instrument_type: 'CE', underlying_key: 'NSE_INDEX|Nifty 50', trading_symbol: 'NIFTY26O1325100CE', lot_size: 65, tick_size: 5, strike_price: 25100, expiry: Date.parse('2026-10-13T10:00:00Z') }];
  let runtime: DailyBotExecutionService;
  let feed: UpstoxMarketFeedService;
  let tools: AgentToolsService;
  let broker: PaperBrokerAdapter;
  let reservations: RiskReservationManager;
  let coordinator: AgentCoordinatorService;
  let session: DailyBotSession;
  let env: EnvService;
  let catalog: InstrumentCatalogService;
  let gateway: any;
  let proposals: ProposalsService;

  function quote(key = optionKey, bid = 100): QuoteSnapshot {
    return { instrumentKey: key, bidPrice: bid, askPrice: bid + 0.2, lastPrice: bid + 0.1, bidQty: 250, askQty: 250, volume: 50000, openInterest: 10000, netChange: 0, netChangePct: 0, isStale: false, timestamp: new Date().toISOString() };
  }
  function tick(bid = 100): void {
    feed.injectSimulatedTick(quote(optionKey, bid));
    feed.injectSimulatedTick(quote('NSE_INDEX|Nifty 50', 25100));
  }
  function history(): Candle[] {
    return Array.from({ length: 40 }, (_, index) => ({ timestamp: new Date(Date.now() - (40 - index) * 300000).toISOString(), open: 25000 + index * 10, high: 25020 + index * 10, low: 24990 + index * 10, close: 25010 + index * 10, volume: 50000 }));
  }
  function makeSession(config: DailyBotConfig, strategy: DailyBotSession['strategySnapshot']): DailyBotSession {
    return { id: '550e8400-e29b-41d4-a716-446655440099', setupId: '550e8400-e29b-41d4-a716-446655440098', status: 'RUNNING', config, strategySnapshot: strategy, startedAt: new Date().toISOString(), stoppedAt: null, lastHeartbeatAt: null, lastMessage: '', tradesExecuted: 0, pendingProposalId: null, pendingProposal: null, processedSignalKeys: [], lastScanBar: null, trades: [], events: [] };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T04:30:00.000Z')); // Monday 10:00 IST
    env = new EnvService();
    gateway = { broadcast: vi.fn() } as any;
    catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog(brokerRecords);
    feed = new UpstoxMarketFeedService(env, new ProtobufDecoderService(), gateway);
    tools = new AgentToolsService(catalog, feed);
    tools.setClosedCandles('NSE_INDEX|Nifty 50', history());
    coordinator = new AgentCoordinatorService(new MarketScannerAgent(tools), new StrategyAnalystAgent(tools), gateway);
    proposals = new ProposalsService(gateway);
    const strategies = new StrategiesService(coordinator, proposals);
    const strategy = structuredClone(strategies.getAllStrategies()[0]!);
    strategy.status = StrategyStatus.PAPER_ACTIVE; // Explicit test authorization; production templates begin unvalidated.
    strategy.risk!.maxAllInTradeLossInr = 500;
    strategy.maxAllInTradeLossInr = 500;
    strategy.risk!.maxRoundTripCostBudgetInr = 100;
    strategy.maxRoundTripCostBudgetInr = 100;
    strategy.risk!.maxCapitalInr = 10000;
    strategy.maxCapitalInr = 10000;
    reservations = new RiskReservationManager(env, gateway);
    reservations.arm(480);
    broker = new PaperBrokerAdapter(catalog, feed, gateway);
    runtime = new DailyBotExecutionService(broker, reservations, coordinator, tools, feed, catalog, env, proposals, gateway);
    const config = DailyBotConfigSchema.parse({ name: 'Morning test', tradingDate: '2026-10-12', tradingMode: TradeMode.PAPER, strategyId: strategy.id, dailyCapitalBudget: 10000, dailyMaxLossAllIn: 600, perTradeMaxLossAllIn: 500, maxCapitalPerTrade: 10000, maxRoundTripCharges: 100 });
    session = makeSession(config, strategy);
    tick();
  });

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function liveHarness(liveQuotes = true) {
    env.config.LIVE_EXECUTION_ENABLED = true;
    session.config.tradingMode = TradeMode.APPROVAL;
    const getQuote = feed.getQuote.bind(feed);
    if (liveQuotes) vi.spyOn(feed, 'getQuote').mockImplementation((key) => {
      const snapshot = getQuote(key);
      return snapshot ? { ...snapshot, provenance: 'LIVE', depthKnown: true } : undefined;
    });
    // Explicit broker test doubles: this fixture never contacts Upstox or places real orders.
    const router = {
      isLive: () => true,
      getFunds: vi.fn(async () => ({ source: 'LIVE_BROKER', status: 'VERIFIED', availableCash: 10000 })),
      getPositions: vi.fn(() => broker.getPositions()),
      getOrders: vi.fn(() => broker.getOrders()),
      getFills: vi.fn(() => broker.getFills()),
      placeOrder: vi.fn((input: any) => broker.placeOrder(input)),
      confirmFill: vi.fn(async (ack: any, quantity: number) => {
        const order = (await broker.getOrders()).find((item) => item.id === ack.orderId);
        return { complete: order?.filledQuantity === quantity, terminal: true, filledQuantity: order?.filledQuantity ?? 0, averagePrice: order?.averageFillPrice ?? 0, status: order?.status };
      }),
      placeProtectiveExit: vi.fn(async () => ({ success: true, gttOrderId: 'gtt_verified_fixture' })),
    };
    const ledger = { getEntries: vi.fn(() => []) };
    const orders = { closePosition: vi.fn(), reconcileExternalExitIfFlat: vi.fn() };
    runtime = new DailyBotExecutionService(broker, reservations, coordinator, tools, feed, catalog, env, proposals, gateway, router as any, { getMode: () => TradeMode.APPROVAL } as any, ledger as any, orders as any);
    return { router, ledger, orders };
  }

  it('keeps Live scans pending until individual approval and protects only the confirmed filled quantity', async () => {
    const { router } = liveHarness();
    await runtime.tick(session);
    expect(session.pendingProposal).not.toBeNull();
    expect(router.placeOrder).not.toHaveBeenCalled();
    expect(session.events.at(-1)?.type).toBe('OWNER_APPROVAL_REQUIRED');
    await runtime.approveEntry(session);
    expect(router.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ side: OrderSide.BUY, orderType: OrderType.LIMIT, reservationId: expect.any(String), proposalId: expect.any(String), signalKey: expect.any(String), reservedRisk: expect.any(Number) }));
    expect(router.placeProtectiveExit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 65, instrumentKey: optionKey }));
    expect(session.trades[0]).toMatchObject({ quantity: 65, gttId: 'gtt_verified_fixture', instrumentSnapshot: { lotSize: 65 } });
  });

  it('rejects simulated quotes in Live even when the funds test double is verified', async () => {
    const { router } = liveHarness(false);
    const preflight = await runtime.preflight(session.config, session.strategySnapshot);
    expect(preflight.checks.find((check) => check.id === 'market-data')?.passed).toBe(false);
    await runtime.tick(session);
    expect(router.placeOrder).not.toHaveBeenCalled();
  });

  it('retains an ambiguous dispatched Live BUY, its pending proposal, consumed signal and full reservation', async () => {
    const { router } = liveHarness();
    await runtime.tick(session);
    const proposalId = session.pendingProposalId;
    router.placeOrder.mockRejectedValueOnce(new Error('Transport failed after dispatch'));
    await expect(runtime.approveEntry(session)).rejects.toThrow('Transport failed');
    expect(session.pendingProposalId).toBe(proposalId);
    expect(session.processedSignalKeys).toHaveLength(1);
    expect(reservations.getHeldReservationsCount()).toBe(1);
    expect(reservations.isKillSwitchActive()).toBe(true);
    expect(router.placeProtectiveExit).not.toHaveBeenCalled();
    await runtime.tick(session);
    expect(router.placeOrder).toHaveBeenCalledOnce();
  });

  it('does not promote a partial Live fill to a full protected trade or release its risk', async () => {
    const { router } = liveHarness();
    await runtime.tick(session);
    router.confirmFill.mockResolvedValueOnce({ complete: false, terminal: false, filledQuantity: 32, averagePrice: 100.45, status: 'PARTIALLY_FILLED' });
    await expect(runtime.approveEntry(session)).rejects.toThrow('partial');
    expect(session.trades).toEqual([]);
    expect(session.pendingProposalId).not.toBeNull();
    expect(reservations.getHeldReservationsCount()).toBe(1);
    expect(router.placeProtectiveExit).not.toHaveBeenCalled();
  });

  it('fails closed for unsupported AST reversal exits and never dispatches an order', async () => {
    session.strategySnapshot.astConfig = { ...session.strategySnapshot.astConfig!, exitRules: { exitOnIndicatorReversal: true } };
    const preflight = await runtime.preflight(session.config, session.strategySnapshot);
    expect(preflight.checks.find((check) => check.id === 'strategy')?.passed).toBe(false);
    await runtime.tick(session);
    expect(await broker.getOrders()).toEqual([]);
  });

  it('does not restore an already persisted Paper reservation or deduct its capital twice', async () => {
    await runtime.tick(session);
    const cash = reservations.getAvailableCash();
    expect(runtime.restoreDailyLedger([structuredClone(session)])).toEqual(new Set([session.id]));
    expect(reservations.getAvailableCash()).toBe(cash);
    expect(reservations.getOpenPositionsCount()).toBe(1);
    expect(reservations.isKillSwitchActive()).toBe(false);
  });

  it('runs the real scanning and rule workflow, creates one protected fill, and deduplicates concurrent ticks', async () => {
    expect(await broker.getPositions()).toEqual([]);
    const workflow = vi.spyOn(coordinator, 'runStrategyWorkflow');
    expect((await runtime.preflight(session.config, session.strategySnapshot)).passed).toBe(true);
    await Promise.all([runtime.tick(session), runtime.tick(session)]);
    await runtime.tick(session);
    expect(workflow).toHaveBeenCalledOnce();
    expect(workflow).toHaveBeenCalledWith(expect.objectContaining({ id: session.config.strategyId }), { strictMarketData: true });
    expect(session.tradesExecuted).toBe(1);
    expect(session.trades[0]!.quantity).toBe(65);
    const position = (await broker.getPositions())[0]!;
    expect(position.stopLossPrice).toBe(session.trades[0]!.stopPrice);
    expect(position.targetPrice).toBeNull();
    expect(reservations.getOpenPositionsCount()).toBe(1);
    expect(reservations.getTotalReservedRisk()).toBeGreaterThan(0);
    expect((await runtime.preflight(session.config, session.strategySnapshot, session)).checks.find((item) => item.id === 'reconciliation')!.passed).toBe(true);
  });

  it('does not execute fabricated seeded candle history and can monitor while warming up', async () => {
    tools.setClosedCandles('NSE_INDEX|Nifty 50', []);
    const preflight = await runtime.preflight(session.config, session.strategySnapshot);
    expect(preflight.passed).toBe(true);
    expect(preflight.checks.find((item) => item.id === 'closed-bars')!.message).toContain('Waiting');
    await runtime.tick(session);
    expect(await broker.getOrders()).toEqual([]);
    expect(session.events[0]!.type).toBe('NO_ENTRY_SIGNAL');
  });

  it('blocks weekend, NSE holiday, stale or invalid timestamps, live mode, and unmanaged exposure', async () => {
    vi.setSystemTime(new Date('2026-10-10T04:30:00.000Z'));
    expect((await runtime.preflight(session.config, session.strategySnapshot)).passed).toBe(false);
    vi.setSystemTime(new Date('2026-10-20T04:30:00.000Z'));
    const holiday = await runtime.preflight({ ...session.config, tradingDate: '2026-10-20' }, session.strategySnapshot);
    expect(holiday.checks.find((item) => item.id === 'market-session')!.passed).toBe(false);
    vi.setSystemTime(new Date('2026-10-12T04:30:00.000Z'));
    const live = await runtime.preflight({ ...session.config, tradingMode: TradeMode.AUTO }, session.strategySnapshot);
    expect(live.checks.find((item) => item.id === 'mode')!.passed).toBe(false);
    feed.injectSimulatedTick({ ...quote(), timestamp: 'invalid' });
    expect((await runtime.preflight(session.config, session.strategySnapshot)).passed).toBe(false);
    tick();
    await broker.placeOrder({ intentId: 'external', tag: 'EXTERNAL', instrumentKey: optionKey, side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: 65 });
    const exposure = await runtime.preflight(session.config, session.strategySnapshot);
    expect(exposure.checks.find((item) => item.id === 'reconciliation')!.passed).toBe(false);
    await runtime.tick(session);
    expect(session.tradesExecuted).toBe(0);
  });

  it('respects smaller daily and trade budgets instead of substituting account defaults', async () => {
    session.config.dailyMaxLossAllIn = 200;
    session.config.perTradeMaxLossAllIn = 200;
    await runtime.tick(session);
    expect(await broker.getOrders()).toEqual([]);
    expect(session.tradesExecuted).toBe(0);
    expect(session.events[0]!.message).toContain('all-in risk budget');
  });

  it('continues initial-stop protection while paused and settles verified fills and charges exactly once', async () => {
    await runtime.tick(session);
    const trade = session.trades[0]!;
    session.status = 'PAUSED';
    tick(90);
    await runtime.tick(session);
    expect(trade.status).toBe('CLOSED');
    const roundTrip = calculateOptionCharges({ buyPrice: trade.entryPrice, sellPrice: trade.exitPrice!, quantity: trade.quantity }).totalRoundTripCharges;
    expect(trade.estimatedCharges).toBeCloseTo(roundTrip, 1);
    expect(trade.realizedNetPnl).toBeCloseTo((trade.exitPrice! - trade.entryPrice) * trade.quantity - roundTrip, 1);
    expect(reservations.getAvailableCash()).toBeCloseTo(10000 + trade.realizedNetPnl, 2);
    const cash = reservations.getAvailableCash();
    await runtime.tick(session);
    expect(reservations.settleReservation(trade.reservationId!, 500)).toBe(false);
    expect(reservations.getAvailableCash()).toBe(cash);
    expect(await broker.getPositions()).toEqual([]);
  });

  it('activates trailing using executable bid after charges and never loosens a tick-aligned stop', async () => {
    session.strategySnapshot.exit.targetPoints = 50;
    await runtime.tick(session);
    const trade = session.trades[0]!;
    tick(105.5);
    await runtime.tick(session);
    expect(trade.trailingActive).toBe(false); // Gross gain alone exceeds 300; net executable gain does not.
    tick(106.5);
    await runtime.tick(session);
    expect(trade.trailingActive).toBe(true);
    expect(trade.protectedNetProfit).toBeGreaterThanOrEqual(100);
    const first = trade.stopPrice;
    tick(110);
    await runtime.tick(session);
    const second = trade.stopPrice;
    expect(second).toBeGreaterThan(first);
    expect(second / 0.05).toBeCloseTo(Math.round(second / 0.05), 5);
    tick(109);
    await runtime.tick(session);
    expect(trade.stopPrice).toBeGreaterThanOrEqual(second);
    feed.injectSimulatedTick({ ...quote(optionKey, 130), timestamp: new Date(Date.now() - 10000).toISOString() });
    await runtime.tick(session);
    expect(trade.stopPrice).toBe(second);
  });

  it('keeps reservations and position open after a rejected cutoff exit and retries even while stopped', async () => {
    await runtime.tick(session);
    const trade = session.trades[0]!;
    await runtime.stop(session, false);
    vi.setSystemTime(new Date('2026-10-12T09:40:00.000Z')); // 15:10 IST cutoff
    tick(105);
    const place = vi.spyOn(broker, 'placeOrder').mockResolvedValueOnce({ orderId: 'rejected', tag: 'TEST', status: 'REJECTED', message: 'Exchange temporarily rejected exit' });
    const cash = reservations.getAvailableCash();
    await runtime.tick(session);
    expect(trade.status).toBe('EXIT_PENDING');
    expect(reservations.getAvailableCash()).toBe(cash);
    expect(reservations.getReservation(trade.reservationId!)!.status).toBe('COMMITTED');
    expect((await broker.getPositions())[0]!.netQuantity).toBe(65);
    place.mockRestore();
    vi.advanceTimersByTime(1);
    tick(105);
    await runtime.tick(session);
    expect(trade.status).toBe('CLOSED');
    expect(session.status).toBe('STOPPED');
    expect(reservations.getOpenPositionsCount()).toBe(0);
  });

  it('retains emergency exit state on stale quotes, freezes entries, and confirms later fills', async () => {
    await runtime.tick(session);
    feed.injectSimulatedTick({ ...quote(), isStale: true });
    await runtime.stop(session, true);
    expect(session.status).toBe('ERROR');
    expect(reservations.isKillSwitchActive()).toBe(true);
    expect(session.trades[0]!.status).toBe('EXIT_PENDING');
    tick(103);
    await runtime.tick(session);
    expect(session.trades[0]!.status).toBe('CLOSED');
    expect(reservations.getOpenPositionsCount()).toBe(0);
  });

  it('does not re-enter a previously executed signal after a protective close', async () => {
    await runtime.tick(session);
    tick(90);
    await runtime.tick(session);
    expect(session.trades[0]!.status).toBe('CLOSED');
    session.lastScanBar = null; // Simulate refreshed worker scheduling the same bar.
    tick(100);
    await runtime.tick(session);
    expect(session.tradesExecuted).toBe(1);
    expect((await broker.getOrders()).filter((order) => order.side === OrderSide.BUY)).toHaveLength(1);
  });

  it('detects lost in-memory broker exposure after recovery without marking it closed', async () => {
    await runtime.tick(session);
    vi.spyOn(broker, 'getPositions').mockResolvedValue([]);
    await runtime.tick(session);
    expect(session.status).toBe('ERROR');
    expect(session.trades[0]!.status).toBe('ERROR');
    expect(reservations.getReservation(session.trades[0]!.reservationId!)!.status).toBe('COMMITTED');
    expect(reservations.isKillSwitchActive()).toBe(true);
  });

  it('rejects raised per-trade caps, counts committed risk, and disallows ledger reset with exposure', () => {
    const held = reservations.acquireReservation({ proposalId: 'one', signalKey: 'one', instrumentKey: optionKey, capitalRequired: 2500, allInRisk: 300 });
    reservations.commitReservationToPosition(held.id, 2500);
    reservations.commitReservationToPosition(held.id, 2500);
    expect(reservations.getOpenPositionsCount()).toBe(1);
    expect(reservations.getTotalReservedRisk()).toBe(300);
    expect(() => reservations.resetForNewTradingDay()).toThrow(RiskGateViolationError);
    expect(() => reservations.acquireReservation({ proposalId: 'two', signalKey: 'two', instrumentKey: optionKey, capitalRequired: 2500, allInRisk: 600, maxTradeRiskCap: 1000 })).toThrow(/maximum per-trade/);
  });

  it('global manual close rejects stale exits without releasing risk, then reconciles its successful owned fill', async () => {
    await runtime.tick(session);
    session.status = 'PAUSED';
    const gateway = { broadcast: vi.fn() } as any;
    const orders = new OrdersService(broker, reservations, new ProposalsService(gateway), gateway);
    const cash = reservations.getAvailableCash();
    feed.injectSimulatedTick({ ...quote(), isStale: true });
    expect((await orders.closePosition(optionKey)).success).toBe(false);
    expect(reservations.getAvailableCash()).toBe(cash);
    tick(105);
    expect((await orders.closePosition(optionKey)).success).toBe(true);
    expect(reservations.getOpenPositionsCount()).toBe(0);
    const settledCash = reservations.getAvailableCash();
    await runtime.tick(session);
    expect(session.trades[0]!.status).toBe('CLOSED');
    expect(session.trades[0]!.exitReason).toBe('EXTERNAL_CONFIRMED_EXIT');
    expect(reservations.getAvailableCash()).toBe(settledCash);
  });

  it('global flatten reports rejected exits and retains committed reservations', async () => {
    await runtime.tick(session);
    feed.injectSimulatedTick({ ...quote(), isStale: true });
    const gateway = { broadcast: vi.fn() } as any;
    const orders = new OrdersService(broker, reservations, new ProposalsService(gateway), gateway);
    const risk = new RiskService(new EnvService(), reservations, broker, undefined, gateway, undefined, undefined, orders);
    const result = await risk.flattenPositions('Stale emergency attempt');
    expect(result.success).toBe(false);
    expect(result.positionsClosed).toBe(0);
    expect(reservations.getReservation(session.trades[0]!.reservationId!)!.status).toBe('COMMITTED');
  });

  it('restores deduplicated same-day confirmed losses and gains after restart', async () => {
    await runtime.tick(session);
    session.status = 'PAUSED';
    tick(90);
    await runtime.tick(session);
    const gateway = { broadcast: vi.fn() } as any;
    const fresh = new RiskReservationManager(new EnvService(), gateway);
    const restored = new DailyBotExecutionService(broker, fresh, coordinator, tools, feed, new InstrumentCatalogService(), new EnvService(), new ProposalsService(gateway), gateway);
    restored.restoreDailyLedger([session, structuredClone(session)]);
    expect(fresh.getAvailableCash()).toBeCloseTo(10000 + session.trades[0]!.realizedNetPnl, 2);
    expect(fresh.getRealizedDailyLoss()).toBeCloseTo(-session.trades[0]!.realizedNetPnl, 2);
    restored.restoreDailyLedger([session]);
    expect(fresh.getAvailableCash()).toBeCloseTo(10000 + session.trades[0]!.realizedNetPnl, 2);
    vi.setSystemTime(new Date('2026-10-13T04:30:00.000Z'));
    expect(fresh.getAvailableCash()).toBe(10000);
    expect(fresh.getRemainingDailyRiskBudget()).toBe(1500);
  });

  it('does not dispatch an entry when its durable intent checkpoint fails', async () => {
    await runtime.tick(session, () => { throw new Error('Disk checkpoint unavailable'); });
    expect(await broker.getOrders()).toEqual([]);
    expect(reservations.getAvailableCash()).toBe(10000);
    expect(reservations.getHeldReservationsCount()).toBe(0);
    expect(session.status).toBe('ERROR');
    expect(session.events.some((event) => event.type === 'ENTRY_SUBMITTING')).toBe(true);
  });

  it('checkpoints intent before dispatch and retains committed risk if an exit checkpoint fails', async () => {
    const place = vi.spyOn(broker, 'placeOrder');
    const saved: DailyBotSession[] = [];
    await runtime.tick(session, (snapshot) => {
      if (snapshot.events[snapshot.events.length - 1]?.type === 'ENTRY_SUBMITTING') expect(place).not.toHaveBeenCalled();
      saved.push(structuredClone(snapshot));
    });
    expect(saved[0]!.pendingProposalId).not.toBeNull();
    expect(saved[0]!.processedSignalKeys).toHaveLength(1);
    expect(saved[saved.length - 1]!.trades[0]!.status).toBe('OPEN');
    place.mockClear();
    session.status = 'PAUSED';
    tick(90);
    await runtime.tick(session, () => { throw new Error('Exit checkpoint unavailable'); });
    expect(place).not.toHaveBeenCalled();
    expect((await broker.getPositions())[0]!.netQuantity).toBe(65);
    expect(reservations.getReservation(session.trades[0]!.reservationId!)!.status).toBe('COMMITTED');
  });

  it('restores a durably confirmed paper position and continues its stop while entries stay paused', async () => {
    await runtime.tick(session);
    const saved = structuredClone(session);
    const gateway = { broadcast: vi.fn() } as any;
    const env = new EnvService();
    const catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog(brokerRecords);
    const freshReservations = new RiskReservationManager(env, gateway);
    const freshBroker = new PaperBrokerAdapter(catalog, feed, gateway);
    const restored = new DailyBotExecutionService(freshBroker, freshReservations, coordinator, tools, feed, catalog, env, new ProposalsService(gateway), gateway);
    expect(restored.restoreDailyLedger([saved])).toEqual(new Set([saved.id]));
    expect((await freshBroker.getPositions())[0]!.netQuantity).toBe(65);
    expect(freshReservations.getReservation(saved.trades[0]!.reservationId!)!.status).toBe('COMMITTED');
    expect(freshReservations.getAvailableCash()).toBeCloseTo(10000 - saved.trades[0]!.entryPrice * 65, 2);
    saved.status = 'PAUSED';
    tick(90);
    await restored.tick(saved);
    expect(saved.trades[0]!.status).toBe('CLOSED');
    expect(saved.status).toBe('PAUSED');
    expect(freshReservations.getAvailableCash()).toBeCloseTo(10000 + saved.trades[0]!.realizedNetPnl, 2);
    expect(await freshBroker.getPositions()).toEqual([]);
  });

  it('does not invent exposure for an unresolved durable entry or exit intent on recovery', async () => {
    await runtime.tick(session);
    const gateway = { broadcast: vi.fn() } as any;
    const env = new EnvService();
    const catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog(brokerRecords);
    const freshReservations = new RiskReservationManager(env, gateway);
    const freshBroker = new PaperBrokerAdapter(catalog, feed, gateway);
    const restored = new DailyBotExecutionService(freshBroker, freshReservations, coordinator, tools, feed, catalog, env, new ProposalsService(gateway), gateway);
    session.trades[0]!.status = 'EXIT_PENDING';
    session.events.push({ timestamp: new Date().toISOString(), type: 'EXIT_SUBMITTING', message: 'Unconfirmed broker exit' });
    expect(restored.restoreDailyLedger([session]).size).toBe(0);
    expect(await freshBroker.getPositions()).toEqual([]);
    expect(freshReservations.isKillSwitchActive()).toBe(true);
  });

  it('preserves remaining daily loss and funding checks after a losing fill', async () => {
    await runtime.tick(session);
    tick(95);
    await runtime.tick(session);
    expect(session.trades[0]!.status).toBe('CLOSED');
    tick(100);
    const running = await runtime.preflight(session.config, session.strategySnapshot, session);
    expect(running.checks.find((check) => check.id === 'capital')!.passed).toBe(true);
    expect(running.checks.find((check) => check.id === 'daily-risk')!.passed).toBe(true);
    expect(running.passed).toBe(true);
    const initial = await runtime.preflight(session.config, session.strategySnapshot);
    expect(initial.checks.find((check) => check.id === 'capital')!.passed).toBe(false);
  });

  it('recovers before Nest catalog initialization and paper startup/poll reconciliation keeps owned exposure unfrozen', async () => {
    await runtime.tick(session);
    const saved = structuredClone(session);
    const gateway = { broadcast: vi.fn() } as any;
    const env = new EnvService();
    const catalog = new InstrumentCatalogService(); // Deliberately no onModuleInit/bootstrap yet.
    expect(catalog.getUnderlyingInstruments('NIFTY')).toEqual([]);
    const freshReservations = new RiskReservationManager(env, gateway);
    const freshBroker = new PaperBrokerAdapter(catalog, feed, gateway);
    const restored = new DailyBotExecutionService(freshBroker, freshReservations, coordinator, tools, feed, catalog, env, new ProposalsService(gateway), gateway);
    expect(restored.restoreDailyLedger([saved])).toEqual(new Set([saved.id]));
    expect(catalog.getUnderlyingInstruments('NIFTY')).toEqual([]); // Recovery uses durable metadata and never creates a catalog.
    const remote = { getPositions: vi.fn().mockResolvedValue([]), getOrders: vi.fn().mockResolvedValue([]) } as any;
    const oauth = { setLastReconciledAt: vi.fn() } as any;
    const reconciliation = new BrokerReconciliationService(freshBroker, remote, freshReservations, oauth, gateway, env);
    await reconciliation.onApplicationBootstrap();
    expect(reconciliation.getLatestReport().status).toBe('CLEAN');
    expect(reconciliation.getLatestReport().brokerPositionsCount).toBe(1);
    const scheduler = new ReconciliationSchedulerService(reconciliation, gateway);
    scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(5000);
    scheduler.stopScheduler();
    expect(scheduler.getHistory()[0]!.status).toBe('CLEAN');
    expect(freshReservations.isKillSwitchActive()).toBe(false);
    expect(remote.getPositions).not.toHaveBeenCalled();
    expect(remote.getOrders).not.toHaveBeenCalled();
    expect((await reconciliation.runReconciliation()).status).toBe('CLEAN');
    expect(remote.getPositions).not.toHaveBeenCalled();
    reconciliation.onModuleDestroy();
  });
});
