import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EnvService } from '../config/env.service';
import { SupervisedExecutionService } from '../orders/supervised-execution.service';
import { GoLiveChecklistService } from '../orders/go-live-checklist.service';
import { OrdersService } from '../orders/orders.service';
import { LiveExitMonitorService } from '../orders/live-exit-monitor.service';
import { ProposalsService } from '../proposals/proposals.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter, BrokerRequestError } from '../broker/upstox-broker.adapter';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';
import { BrokerRouterService } from '../broker/broker-router.service';
import { TradingModeService } from '../trading/trading-mode.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { TokenStorageService } from '../broker/token-storage.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { EventsGateway } from '../websocket/events.gateway';
import { AgentType, EnvSchema, OrderStatus, OrderSide, OrderType, ProductType, ProposalStatus, TradeProposal, TradeMode, ExitProtectionStatus } from '@trading-bot/contracts';

describe('Supervised entries and durable broker-confirmed execution', () => {
  let directory: string;
  let env: EnvService;
  let tokens: TokenStorageService;
  let proposals: ProposalsService;
  let paper: PaperBrokerAdapter;
  let live: UpstoxBrokerAdapter;
  let ledger: LiveExecutionLedgerService;
  let router: BrokerRouterService;
  let mode: TradingModeService;
  let risk: RiskReservationManager;
  let checklist: GoLiveChecklistService;
  let execution: SupervisedExecutionService;
  let orders: OrdersService;
  let feed: any;
  let proposal: TradeProposal;
  let brokerOrder: any;
  let brokerPositions: any[];
  let funds: number;
  let entrySubmitted: boolean;
  let fetchStub: ReturnType<typeof vi.fn>;
  const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ status: 'success', data }) }) as Response;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T04:30:00.000Z'));
    directory = fs.mkdtempSync('/private/tmp/broker-safety-');
    env = { config: EnvSchema.parse({ NODE_ENV: 'test', STATE_DIRECTORY: directory, LIVE_EXECUTION_ENABLED: true, TOKEN_ENCRYPTION_KEY: 'private-fixture-encryption-key-32-characters' }) } as EnvService;
    tokens = new TokenStorageService(env);
    const gateway = new EventsGateway();
    const catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog([{ segment: 'NSE_FO', instrument_type: 'CE', instrument_key: 'NSE_FO|12345', underlying_key: 'NSE_INDEX|Nifty 50',
      trading_symbol: 'NIFTY_TEST_OPTION', lot_size: 25, tick_size: 5, strike_price: 25000, expiry: Date.now() + 7 * 86400000 }]);
    feed = { getQuote: (key: string) => ({ instrumentKey: key, lastPrice: 122, bidPrice: 121.9, askPrice: 122,
      bidQty: 50, askQty: 50, depthKnown: true, provenance: 'LIVE', isStale: false, timestamp: new Date().toISOString() }),
      getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 15 }), getAllQuotes: () => [] };
    mode = new TradingModeService(env);
    risk = new RiskReservationManager(env, gateway, mode); risk.arm(60);
    paper = new PaperBrokerAdapter(catalog, feed, gateway, env, path.join(directory, 'paper.json'));
    ledger = new LiveExecutionLedgerService(path.join(directory, 'live.json'));
    live = new UpstoxBrokerAdapter(env, catalog, tokens, ledger, risk, mode);
    router = new BrokerRouterService(mode, paper, live, risk, ledger);
    proposals = new ProposalsService(gateway);
    checklist = new GoLiveChecklistService(env, tokens, path.join(directory, 'checklist.json'));
    execution = new SupervisedExecutionService(env, proposals, paper, live, feed, risk, checklist, gateway, router, ledger);
    orders = new OrdersService(paper, risk, proposals, gateway, router, ledger);
    proposal = { id: '550e8400-e29b-41d4-a716-446655440001', strategyId: '550e8400-e29b-41d4-a716-446655440002', strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST, instrumentKey: 'NSE_FO|12345', symbol: 'NIFTY_TEST_OPTION', side: OrderSide.BUY, product: ProductType.I,
      suggestedEntryPrice: 122.5, suggestedStopPrice: 114, suggestedTargetPrice: 136, lotSize: 25, quantity: 25,
      estimatedCapitalRequired: 3062.5, estimatedRoundTripCosts: 58.2, allInMaxLoss: 300, estimatedNetProfit: 279.3,
      evidence: { indicators: { spreadPct: 0.1 }, rationale: 'Explicit test fixture', confidence: 0.8 }, status: ProposalStatus.APPROVED,
      expiresAt: new Date(Date.now() + 180000).toISOString(), createdAt: new Date().toISOString() };
    proposals.addProposal(proposal); funds = 10000; entrySubmitted = false;
    brokerPositions = [{ instrument_token: proposal.instrumentKey, trading_symbol: proposal.symbol, quantity: 25, buy_quantity: 25, sell_quantity: 0, buy_price: 122.35, sell_price: 0, last_price: 122.35 }];
    brokerOrder = { order_id: 'B1', instrument_token: proposal.instrumentKey, quantity: 25, filled_quantity: 25, average_price: 122.35,
      transaction_type: 'BUY', order_type: 'LIMIT', product: 'I', price: 122.5, status: 'complete', order_timestamp: new Date().toISOString() };
    fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = String(url);
      if (endpoint.endsWith('/get-funds-and-margin')) return response({ available_to_trade: { total: funds, cash_available_to_trade: { total: funds, cash: { added_today: 0 }, margin_used: { total: 0, span_exposure: 0 } }, pledge_available_to_trade: { total: 0, margin_from_pledge: { total: 0 }, margin_used: { total: 0, span_exposure: 0 } } } });
      if (endpoint.endsWith('/order/place')) {
        if (JSON.parse(String(init?.body)).transaction_type === 'SELL') {
          brokerOrder = { ...brokerOrder, order_id: 'S1', transaction_type: 'SELL', average_price: 135, status: 'complete', order_timestamp: new Date().toISOString() };
          brokerPositions = []; return response({ order_ids: ['S1'] });
        }
        entrySubmitted = true;
        if (brokerOrder.filled_quantity === 0) brokerPositions = [];
        else brokerPositions[0]!.quantity = brokerOrder.filled_quantity;
        return response({ order_ids: ['B1'] });
      }
      if (endpoint.endsWith('/retrieve-all')) return response(entrySubmitted ? [brokerOrder] : []);
      if (endpoint.endsWith('/short-term-positions')) return response(entrySubmitted ? brokerPositions : []);
      if (endpoint.endsWith('/gtt/place')) return response({ gtt_order_id: 'G1' });
      if (endpoint.includes('/order/gtt?')) return response([{ gtt_order_id: 'G1', instrument_token: proposal.instrumentKey, quantity: brokerOrder.filled_quantity,
        rules: [{ strategy: 'ENTRY', trigger_type: 'BELOW', transaction_type: 'SELL', trigger_price: 114, status: 'SCHEDULED' }] }]);
      if (endpoint.includes('/order/cancel?')) { brokerOrder.status = 'cancelled'; return response({ order_ids: ['B1'] }); }
      if (endpoint.endsWith('/gtt/cancel')) return response({ gtt_order_ids: ['G1'] });
      throw new Error('Unexpected stub endpoint: ' + endpoint);
    });
    vi.stubGlobal('fetch', fetchStub);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); fs.rmSync(directory, { recursive: true, force: true }); });
  function activateLive(): void {
    tokens.storeToken({ accessToken: 'genuine-format-fixture-credential', expiresInSeconds: 3600, userId: 'FIXTURE', userType: 'individual' });
    for (const item of checklist.getChecklist().items) if (item.id !== 'chk_04_auth') checklist.signOffItem(item.id, 'Explicit owner verification evidence from a stubbed safety drill.');
    checklist.completeChecklist('Fixture owner'); risk.configureMode(TradeMode.APPROVAL);
    mode.setMode(TradeMode.APPROVAL, { availableCash: 10000, totalCapital: 10000, reservedMargin: 0, source: 'LIVE_BROKER', status: 'VERIFIED', verifiedAt: new Date().toISOString() });
    risk.synchronizeFunds(10000); risk.arm(60);
  }
  function deferFundsCall(nth: number): { reached: Promise<void>; release: () => void } {
    const original = fetchStub.getMockImplementation()!;
    let fundsCalls = 0; let markReached!: () => void; let release!: () => void;
    const reached = new Promise<void>((resolve) => { markReached = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => {
      if (String(args[0]).endsWith('/get-funds-and-margin') && ++fundsCalls === nth) { markReached(); await pending; }
      return original(...args);
    });
    return { reached, release };
  }
  function expectNoBuy(): void {
    expect(fetchStub.mock.calls.some(([url, init]) => String(url).endsWith('/order/place') && JSON.parse(String(init?.body)).transaction_type === 'BUY')).toBe(false);
    expect(risk.getActiveReservations()).toHaveLength(0); expect(ledger.getEntries()).toHaveLength(0);
  }
  it('requires current owner approval and bounded account arming', async () => {
    proposals.addProposal({ ...proposal, status: ProposalStatus.PENDING });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/APPROVED/);
    proposals.addProposal({ ...proposal, expiresAt: new Date(Date.now() - 1).toISOString() });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/expired/i);
    proposals.addProposal(proposal); risk.disarm();
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/disarmed/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it('rejects a missing quote even when optional freshness flags are false', async () => {
    feed.getQuote = () => undefined;
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id, revalidateFreshness: false })).rejects.toThrow(/missing quote/);
    expect(risk.getActiveReservations()).toHaveLength(0);
  });
  it('rejects live simulated quotes and missing bid/ask depth', async () => {
    activateLive(); const quote = feed.getQuote(proposal.instrumentKey);
    feed.getQuote = () => ({ ...quote, provenance: 'SIMULATED' });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/genuine fresh broker depth/);
    feed.getQuote = () => ({ ...quote, depthKnown: false });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/genuine fresh broker depth/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it('blocks weekend and unverified-calendar Live entries before reserving risk or contacting the broker', async () => {
    activateLive(); vi.setSystemTime(new Date('2026-10-10T04:30:00.000Z'));
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/verified exchange calendar/);
    vi.setSystemTime(new Date('2027-01-04T04:30:00.000Z'));
    tokens.storeToken({ accessToken: 'genuine-format-fixture-credential', expiresInSeconds: 3600, userId: 'FIXTURE', userType: 'individual' });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/verified exchange calendar/);
    expect(risk.getActiveReservations()).toHaveLength(0); expect(fetchStub).not.toHaveBeenCalled();
  });
  it('uses the actual simulated execution price and simulated protection in Testing', async () => {
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result.orderStatus).toBe(OrderStatus.PROTECTED); expect(result.averagePrice).toBe(122.25);
    expect(result.averagePrice).not.toBe(proposal.suggestedEntryPrice);
    expect(paper.getFills()[0]?.chargesSource).toBe('SIMULATED'); expect(fetchStub).not.toHaveBeenCalled();
  });
  it('retains risk and freezes entries on a simulated ambiguous dispatch', async () => {
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id, simulateTimeout: true });
    expect(result.orderStatus).toBe(OrderStatus.UNKNOWN_BROKER_STATE); expect(result.filledQuantity).toBe(0);
    expect(risk.getActiveReservations()).toHaveLength(1); expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('rejects mock tokens without making any broker request', async () => {
    tokens.storeToken({ accessToken: 'mock_upstox_token', expiresInSeconds: 3600, userId: 'FIXTURE', userType: 'individual' });
    await expect(live.placeOrder({ intentId: 'no-live-mock', instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, quantity: 25, price: 122.5 })).rejects.toThrow(/genuine/);
    expect(fetchStub).not.toHaveBeenCalled(); expect(checklist.getChecklist().liveExecutionPermitted).toBe(false);
  });
  it('requires the execution feature flag for every write', async () => {
    activateLive(); (env.config as any).LIVE_EXECUTION_ENABLED = false;
    await expect(live.placeOrder({ intentId: 'disabled', instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, quantity: 25, price: 122.5 })).rejects.toThrow(/disabled/);
    await expect(live.cancelOrder('B1')).rejects.toThrow(/disabled/); expect(fetchStub).not.toHaveBeenCalled();
  });
  it('preserves verified zero funds and blocks buying instead of substituting capital', async () => {
    activateLive(); funds = 0;
    expect(await live.getFunds()).toMatchObject({ availableCash: 0, source: 'LIVE_BROKER', status: 'VERIFIED' });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/funds/);
    expect(fetchStub.mock.calls.some(([url]) => String(url).endsWith('/order/place'))).toBe(false);
  });
  it('never substitutes pledge collateral or combined margin for spendable option-buy cash', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).endsWith('/get-funds-and-margin')
      ? response({ available_to_trade: { total: 50000, cash_available_to_trade: { total: 0 }, pledge_available_to_trade: { total: 50000, margin_from_pledge: { total: 50000 } } } }) : original(...args));
    expect(await live.getFunds()).toMatchObject({ availableCash: 0, totalCollateral: 50000, source: 'LIVE_BROKER', status: 'VERIFIED' });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/funds/);
    const call = fetchStub.mock.calls[0]!;
    expect(String(call[0])).toBe('https://api.upstox.com/v3/user/get-funds-and-margin');
    expect((call[1]?.headers as Record<string, string>)['Api-Version']).toBe('3.0');
    expect(fetchStub.mock.calls.some(([url]) => String(url).endsWith('/order/place'))).toBe(false);
  });
  it.each([1, 2])('blocks disarming during funds read %i before any BUY, releasing only undispatched risk', async (nth) => {
    activateLive(); const deferred = deferFundsCall(nth);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/disarmed/);
    await deferred.reached; risk.disarm(); deferred.release(); await failure;
    expectNoBuy();
  });
  it('blocks an emergency stop while adapter funds are awaiting a response', async () => {
    activateLive(); const deferred = deferFundsCall(2);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/disarmed|frozen/i);
    await deferred.reached; risk.setKillSwitch(true); deferred.release(); await failure;
    expectNoBuy(); expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('rechecks arming in the router after its asynchronous funds read', async () => {
    activateLive(); const deferred = deferFundsCall(1);
    const pending = router.placeOrder({ intentId: 'router-disarmed', side: OrderSide.BUY, instrumentKey: proposal.instrumentKey, quantity: 25, price: 122.5 });
    const failure = expect(pending).rejects.toMatchObject({ definiteRejection: true });
    await deferred.reached; risk.disarm(); deferred.release(); await failure;
    expectNoBuy();
  });
  it.each([false, true])('rejects mode changes while funds await, including a return to the original mode (%s)', async (returnToLive) => {
    activateLive(); const deferred = deferFundsCall(1);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/mode changed/i);
    await deferred.reached; mode.setMode(TradeMode.PAPER); proposals.invalidateApprovals();
    if (returnToLive) mode.setMode(TradeMode.APPROVAL, { availableCash: 10000, totalCapital: 10000, reservedMargin: 0, source: 'LIVE_BROKER', status: 'VERIFIED', verifiedAt: new Date().toISOString() });
    deferred.release(); await failure; expectNoBuy();
  });
  it('preserves the caller mode revision and refuses an obsolete router request without funds calls', async () => {
    activateLive(); const revision = mode.getRevision(); mode.setMode(TradeMode.PAPER);
    mode.setMode(TradeMode.APPROVAL, { availableCash: 10000, totalCapital: 10000, reservedMargin: 0, source: 'LIVE_BROKER', status: 'VERIFIED', verifiedAt: new Date().toISOString() });
    await expect(router.placeOrder({ intentId: 'stale-router', expectedModeRevision: revision, side: OrderSide.BUY, instrumentKey: proposal.instrumentKey, quantity: 25, price: 122.5 })).rejects.toMatchObject({ definiteRejection: true });
    expect(fetchStub).not.toHaveBeenCalled(); expectNoBuy();
  });
  it('revalidates owner approval at final dispatch after a held reservation and delayed broker funds', async () => {
    activateLive(); const deferred = deferFundsCall(2);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/approval changed/i);
    await deferred.reached; expect(risk.getActiveReservations()[0]?.status).toBe('HELD');
    proposals.rejectProposal(proposal.id, 'Owner revoked before dispatch'); deferred.release(); await failure;
    expectNoBuy();
  });
  it('refuses a quote that became stale while adapter funds were pending', async () => {
    activateLive(); const quote = feed.getQuote(proposal.instrumentKey); feed.getQuote = () => quote;
    const deferred = deferFundsCall(2);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/fresh executable quote/i);
    await deferred.reached; vi.setSystemTime(new Date(Date.now() + 4000)); deferred.release(); await failure;
    expectNoBuy();
  });
  it('rejects funds from a replaced OAuth session and never sends the reserved BUY', async () => {
    activateLive(); const deferred = deferFundsCall(2);
    const failure = expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/authentication changed/i);
    await deferred.reached;
    tokens.storeToken({ accessToken: 'another-genuine-fixture-credential', expiresInSeconds: 3600, userId: 'OTHER_FIXTURE', userType: 'individual' });
    deferred.release(); await failure; expectNoBuy();
  });
  it('never applies a delayed standalone funds response to a different OAuth session', async () => {
    activateLive(); const deferred = deferFundsCall(1);
    const failure = expect(live.getFunds()).rejects.toBeInstanceOf(BrokerRequestError);
    await deferred.reached;
    tokens.storeToken({ accessToken: 'another-genuine-fixture-credential', expiresInSeconds: 3600, userId: 'OTHER_FIXTURE', userType: 'individual' });
    deferred.release(); await failure; expectNoBuy();
  });
  it.each(['EXTERNAL_POSITION', 'PENDING_ORDER', 'FAILED_POSITIONS'] as const)('verifies current account state and freezes a BUY on %s', async (condition) => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => {
      const endpoint = String(args[0]);
      if (endpoint.endsWith('/short-term-positions') && condition === 'EXTERNAL_POSITION') return response(brokerPositions);
      if (endpoint.endsWith('/short-term-positions') && condition === 'FAILED_POSITIONS') return response(null, 503);
      if (endpoint.endsWith('/retrieve-all') && condition === 'PENDING_ORDER') return response([{ ...brokerOrder, status: 'open', filled_quantity: 0, average_price: 0 }]);
      return original(...args);
    });
    await expect(execution.executeSupervisedProposal({ proposalId: proposal.id })).rejects.toThrow(/exposure|pending|HTTP 503/i);
    expectNoBuy(); expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('uses HFT V3 JSON, confirmed fills, and only a SELL stop for an existing long', async () => {
    activateLive(); (env.config as any).UPSTOX_ALGO_NAME = 'APPROVED_FIXTURE_ALGO';
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result).toMatchObject({ orderStatus: OrderStatus.PROTECTED, filledQuantity: 25, averagePrice: 122.35, gttOrderId: 'G1' });
    const place = fetchStub.mock.calls.find(([url]) => String(url) === 'https://api-hft.upstox.com/v3/order/place')!;
    expect((place[1]?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((place[1]?.headers as Record<string, string>)['X-Algo-Name']).toBe('APPROVED_FIXTURE_ALGO');
    expect(JSON.parse(String(place[1]?.body))).toMatchObject({ transaction_type: 'BUY', instrument_token: 'NSE_FO|12345', market_protection: -1 });
    const gtt = fetchStub.mock.calls.find(([url]) => String(url).endsWith('/gtt/place'))!;
    expect((gtt[1]?.headers as Record<string, string>)['X-Algo-Name']).toBe('APPROVED_FIXTURE_ALGO');
    expect(JSON.parse(String(gtt[1]?.body))).toMatchObject({ type: 'SINGLE', transaction_type: 'SELL', rules: [{ strategy: 'ENTRY', trigger_type: 'BELOW', trigger_price: 114, market_protection: -1 }] });
    expect(result.message).toContain('target is managed by the server');
    expect(ledger.getFills()[0]).toMatchObject({ fillPrice: 122.35, chargesSource: 'ESTIMATED' });
    expect(risk.getActiveReservations()[0]?.status).toBe('COMMITTED');
  });
  it('aggregates multiple genuine order IDs using actual filled quantities and prices', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => {
      const endpoint = String(args[0]);
      if (endpoint.endsWith('/order/place')) { entrySubmitted = true; return response({ order_ids: ['B1', 'B2'] }); }
      if (endpoint.endsWith('/retrieve-all')) return response(entrySubmitted ? [{ ...brokerOrder, quantity: 10, filled_quantity: 10, average_price: 120 }, { ...brokerOrder, order_id: 'B2', quantity: 15, filled_quantity: 15, average_price: 124 }] : []);
      return original(...args);
    });
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result).toMatchObject({ orderStatus: OrderStatus.PROTECTED, filledQuantity: 25, averagePrice: 122.4 });
    expect(ledger.getIntent(result.intentId)?.orderIds).toEqual(['B1', 'B2']);
    expect(risk.getActiveReservations()[0]?.reservedCapital).toBe(3060);
  });
  it('does not turn an accepted pending order into a fictitious fill', async () => {
    activateLive(); brokerOrder.filled_quantity = 0; brokerOrder.average_price = 0; brokerOrder.status = 'open';
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result.filledQuantity).toBe(0); expect(result.orderStatus).toBe(OrderStatus.ACKNOWLEDGED);
    expect(ledger.getFills()).toHaveLength(0); expect(risk.getActiveReservations()[0]?.status).toBe('HELD');
    expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('recovers a late actual fill, commits held capital and verifies stop protection without racing an active workflow', async () => {
    activateLive(); brokerOrder.filled_quantity = 0; brokerOrder.average_price = 0; brokerOrder.status = 'open';
    await execution.executeSupervisedProposal({ proposalId: proposal.id });
    const intentId = ledger.getEntries()[0]!.intentId;
    brokerOrder.filled_quantity = 25; brokerOrder.average_price = 122.35; brokerOrder.status = 'complete';
    brokerPositions = [{ instrument_token: proposal.instrumentKey, trading_symbol: proposal.symbol, quantity: 25, buy_quantity: 25, sell_quantity: 0, buy_price: 122.35, sell_price: 0, last_price: 122.35 }];
    const monitor = new LiveExitMonitorService(router, ledger, orders, feed, risk, new EventsGateway());
    ledger.tryLockIntent(intentId); await monitor.tick();
    expect(fetchStub.mock.calls.some(([url]) => String(url).endsWith('/gtt/place'))).toBe(false);
    ledger.unlockIntent(intentId); await monitor.tick();
    expect(risk.getActiveReservations()[0]).toMatchObject({ status: 'COMMITTED', reservedCapital: 3058.75 });
    expect(ledger.getIntent(intentId)).toMatchObject({ state: OrderStatus.PROTECTED, gttOrderId: 'G1', protectionVerified: true });
    expect(risk.isKillSwitchActive()).toBe(true);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/order/place'))).toHaveLength(1);
  });
  it('cancels a partial remainder before protecting only the confirmed quantity', async () => {
    activateLive(); brokerOrder.filled_quantity = 10; brokerOrder.status = 'partially filled';
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result).toMatchObject({ orderStatus: OrderStatus.PARTIALLY_FILLED, protectionStatus: ExitProtectionStatus.PROTECTED_GTT, filledQuantity: 10, averagePrice: 122.35 });
    const endpoints = fetchStub.mock.calls.map(([url]) => String(url));
    expect(endpoints.findIndex((url) => url.includes('/order/cancel?'))).toBeLessThan(endpoints.findIndex((url) => url.endsWith('/gtt/place')));
    const gtt = fetchStub.mock.calls.find(([url]) => String(url).endsWith('/gtt/place'))!;
    expect(JSON.parse(String(gtt[1]?.body)).quantity).toBe(10);
    expect(risk.getActiveReservations()[0]?.reservedCapital).toBe(1223.5);
  });
  it('holds ambiguous dispatch across restart and never retries a durable intent', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).endsWith('/order/place') ? response({ order_id: 'wrong-singular-field' }) : original(...args));
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result.orderStatus).toBe(OrderStatus.UNKNOWN_BROKER_STATE); expect(risk.getActiveReservations()).toHaveLength(1);
    const restarted = new UpstoxBrokerAdapter(env, new InstrumentCatalogService(), tokens, new LiveExecutionLedgerService(ledger.storagePath));
    await expect(restarted.placeOrder({ intentId: result.intentId, instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, quantity: 25, price: 122.5 })).rejects.toThrow(/unresolved durable intent/);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/order/place'))).toHaveLength(1);
  });
  it('retains an accepted order reservation when a subsequent fill lookup is rejected', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).endsWith('/retrieve-all') && entrySubmitted ? response(null, 401) : original(...args));
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result.orderStatus).toBe(OrderStatus.UNKNOWN_BROKER_STATE);
    expect(risk.getActiveReservations()[0]?.status).toBe('HELD');
    expect(risk.isKillSwitchActive()).toBe(true);
    expect(ledger.getIntent(result.intentId)?.orderIds).toEqual(['B1']);
  });
  it('retains a known protective ID and freezes when protection verification fails', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).includes('/order/gtt?') ? response([]) : original(...args));
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result).toMatchObject({ orderStatus: OrderStatus.PROTECTION_FAILED, filledQuantity: 25, averagePrice: 122.35 });
    expect(risk.isKillSwitchActive()).toBe(true); expect(risk.getActiveReservations()[0]?.status).toBe('COMMITTED');
    expect(new LiveExecutionLedgerService(ledger.storagePath).getEntryForInstrument(proposal.instrumentKey)?.gttOrderId).toBe('G1');
  });
  it('never resubmits an ambiguous protective stop that may already exist at the broker', async () => {
    activateLive(); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => {
      if (String(args[0]).endsWith('/gtt/place')) throw new Error('Network timeout after stop dispatch');
      return original(...args);
    });
    const result = await execution.executeSupervisedProposal({ proposalId: proposal.id });
    expect(result.orderStatus).toBe(OrderStatus.PROTECTION_FAILED);
    expect(ledger.getIntent(result.intentId)?.protectionDispatchPending).toBe(true);
    await expect(live.placeProtectiveExit({ instrumentKey: proposal.instrumentKey, quantity: 25, stopLossPrice: 114, targetPrice: 136 })).rejects.toThrow(/unknown outcome/);
    await expect(orders.closePosition(proposal.instrumentKey)).rejects.toThrow(/No competing SELL/);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/gtt/place'))).toHaveLength(1);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/order/place'))).toHaveLength(1);
    expect(risk.getActiveReservations()).toHaveLength(1);
  });
  it('requires confirmed stop cancellation, filled SELL and flat positions before releasing risk', async () => {
    activateLive(); await execution.executeSupervisedProposal({ proposalId: proposal.id });
    risk.setKillSwitch(true); risk.disarm();
    expect(await orders.closePosition(proposal.instrumentKey)).toMatchObject({ success: true, orderId: 'S1', quantity: 25, exitPrice: 135, status: OrderStatus.CLOSED });
    const calls = fetchStub.mock.calls;
    const cancelled = calls.findIndex(([url]) => String(url).endsWith('/gtt/cancel'));
    const sell = calls.findIndex(([url, init]) => String(url).endsWith('/order/place') && JSON.parse(String(init?.body)).transaction_type === 'SELL');
    expect(cancelled).toBeLessThan(sell); expect(risk.getActiveReservations()).toHaveLength(0);
    expect(new LiveExecutionLedgerService(ledger.storagePath).getPositions()).toHaveLength(0);
  });
  it('does not submit a competing SELL after unconfirmed stop cancellation', async () => {
    activateLive(); await execution.executeSupervisedProposal({ proposalId: proposal.id }); const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).endsWith('/gtt/cancel') ? response({ gtt_order_ids: ['different-stop'] }) : original(...args));
    await expect(orders.closePosition(proposal.instrumentKey)).rejects.toThrow(/did not confirm stop cancellation/);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/order/place'))).toHaveLength(1);
    expect(risk.getActiveReservations()).toHaveLength(1); expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('cancels a scheduled stop left behind by a uniquely confirmed manual SELL before releasing risk', async () => {
    activateLive(); await execution.executeSupervisedProposal({ proposalId: proposal.id });
    brokerPositions = []; brokerOrder = { ...brokerOrder, order_id: 'MANUAL_SELL', transaction_type: 'SELL', average_price: 130, order_timestamp: new Date(Date.now() + 100).toISOString() };
    expect(await orders.reconcileExternalExitIfFlat(proposal.instrumentKey)).toMatchObject({ success: true, orderId: 'MANUAL_SELL', quantity: 25, status: OrderStatus.CLOSED });
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/gtt/cancel'))).toHaveLength(1);
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/order/place'))).toHaveLength(1);
    expect(risk.getActiveReservations()).toHaveLength(0);
  });
  it('retains exit risk when an outstanding stop lookup is unavailable despite a flat broker position', async () => {
    activateLive(); await execution.executeSupervisedProposal({ proposalId: proposal.id });
    brokerPositions = []; brokerOrder = { ...brokerOrder, order_id: 'MANUAL_SELL', transaction_type: 'SELL', average_price: 130, order_timestamp: new Date(Date.now() + 100).toISOString() };
    const original = fetchStub.getMockImplementation()!;
    fetchStub.mockImplementation(async (...args: [string | URL | Request, RequestInit?]) => String(args[0]).includes('/order/gtt?') ? response(null, 503) : original(...args));
    await expect(orders.reconcileExternalExitIfFlat(proposal.instrumentKey)).rejects.toThrow(/HTTP 503/);
    expect(risk.getActiveReservations()).toHaveLength(1); expect(risk.isKillSwitchActive()).toBe(true);
  });
  it('requires explicit owner evidence, persists sign-off, and invalidates it when evidence changes', () => {
    expect(checklist.getChecklist().items.every((item) => !item.passed)).toBe(true);
    expect(() => checklist.completeChecklist('Fixture owner')).toThrow(/owner evidence/);
    expect(() => checklist.signOffItem('chk_02_ip', 'config')).toThrow(/evidence/);
    activateLive(); expect(new GoLiveChecklistService(env, tokens, path.join(directory, 'checklist.json')).isLiveExecutionPermitted()).toBe(true);
    checklist.signOffItem('chk_02_ip', 'Evidence changed by authenticated fixture owner.');
    expect(checklist.isLiveExecutionPermitted()).toBe(false);
  });
  it('persists simulated orders, virtual cash and matched FIFO exits across restart', async () => {
    await paper.placeOrder({ intentId: 'first-buy', instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, quantity: 25, orderType: OrderType.MARKET, product: ProductType.I });
    const firstSell = await paper.placeOrder({ intentId: 'first-sell', instrumentKey: proposal.instrumentKey, side: OrderSide.SELL, quantity: 25, orderType: OrderType.MARKET, product: ProductType.I });
    const first = paper.getConfirmedExit(firstSell.orderId, 122.25, 25)!;
    feed.getQuote = () => ({ instrumentKey: proposal.instrumentKey, lastPrice: 130, bidPrice: 130, askPrice: 130.1, isStale: false, timestamp: new Date().toISOString() });
    await paper.placeOrder({ intentId: 'second-buy', instrumentKey: proposal.instrumentKey, side: OrderSide.BUY, quantity: 25, orderType: OrderType.MARKET, product: ProductType.I });
    const secondSell = await paper.placeOrder({ intentId: 'second-sell', instrumentKey: proposal.instrumentKey, side: OrderSide.SELL, quantity: 25, orderType: OrderType.MARKET, product: ProductType.I });
    const second = paper.getConfirmedExit(secondSell.orderId, 130.35, 25)!;
    expect(second.netPnl).not.toBe(first.netPnl);
    const restored = new PaperBrokerAdapter(new InstrumentCatalogService(), feed, new EventsGateway(), env, path.join(directory, 'paper.json'));
    expect(restored.getFills()).toHaveLength(4); expect(await restored.getFunds()).toEqual(await paper.getFunds());
    expect((await restored.getFunds()).availableCash).not.toBe(10000);
    expect((await restored.getPositions()).filter((position) => position.netQuantity !== 0)).toHaveLength(0);
  });
});
