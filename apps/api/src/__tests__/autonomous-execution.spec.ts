import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { EnvService } from '../config/env.service';
import { GoLiveChecklistService } from '../orders/go-live-checklist.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { StrategiesService } from '../strategies/strategies.service';
import { SupervisedExecutionService } from '../orders/supervised-execution.service';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { UpstoxOAuthService } from '../broker/upstox-oauth.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AutonomousExecutionService } from '../orders/autonomous-execution.service';
import {
  StrategyStatus,
  ProposalStatus,
  TradeProposal,
  AllowedOptionType,
  OrderStatus,
  ExitProtectionStatus,
} from '@trading-bot/contracts';

describe('Bounded Autonomous Execution & Readiness Gates (Phase 7)', () => {
  let envService: EnvService;
  let checklistService: GoLiveChecklistService;
  let tokenStorage: TokenStorageService;
  let catalogService: InstrumentCatalogService;
  let gateway: EventsGateway;
  let oauthService: UpstoxOAuthService;
  let paperBroker: PaperBrokerAdapter;
  let upstoxBroker: UpstoxBrokerAdapter;
  let reservationManager: RiskReservationManager;
  let reconciliationService: BrokerReconciliationService;
  let proposalsService: ProposalsService;
  let strategiesService: StrategiesService;
  let supervisedExecution: SupervisedExecutionService;
  let notifications: NotificationsService;
  let autonomousService: AutonomousExecutionService;
  let mockFeed: any;
  const TEST_STRATEGY_ID = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    envService = new EnvService();
    tokenStorage = new TokenStorageService(envService);
    checklistService = new GoLiveChecklistService(envService, tokenStorage);
    gateway = new EventsGateway();
    oauthService = new UpstoxOAuthService(envService, tokenStorage, gateway);
    catalogService = new InstrumentCatalogService();
    notifications = new NotificationsService(gateway);

    mockFeed = {
      getQuote: (key: string) => ({
        instrumentKey: key,
        lastPrice: 122.5,
        bidPrice: 122.0,
        askPrice: 123.0, // 0.81% spread (<= 1.0%)
        isStale: false,
        timestamp: new Date().toISOString(),
      }),
      getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 18 }),
    };

    paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);
    upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);
    reservationManager = new RiskReservationManager(envService, gateway);

    reconciliationService = new BrokerReconciliationService(
      paperBroker,
      upstoxBroker,
      reservationManager,
      oauthService,
      gateway,
    );

    proposalsService = new ProposalsService(gateway);
    const mockCoordinator = { runStrategyWorkflow: async () => ({}) } as any;
    strategiesService = new StrategiesService(mockCoordinator, proposalsService);

    supervisedExecution = new SupervisedExecutionService(
      envService,
      proposalsService,
      paperBroker,
      upstoxBroker,
      mockFeed as any,
      reservationManager,
      checklistService,
      gateway,
    );

    autonomousService = new AutonomousExecutionService(
      envService,
      checklistService,
      reconciliationService,
      tokenStorage,
      mockFeed as any,
      strategiesService,
      proposalsService,
      supervisedExecution,
      reservationManager,
      gateway,
      notifications,
      paperBroker,
    );
  });

  it('checkReadiness() blocks arming when Go-Live checklist is unsigned', async () => {
    // Initial state: checklist is unsigned
    expect(checklistService.isLiveExecutionPermitted()).toBe(false);

    const report = await autonomousService.checkReadiness();
    expect(report.isEligibleForAuto).toBe(false);

    const goLiveItem = report.items.find((i) => i.id === 'auto_03');
    expect(goLiveItem?.passed).toBe(false);

    // Attempting to arm throws ForbiddenException
    await expect(
      autonomousService.armAutonomous({
        strategyId: TEST_STRATEGY_ID,
        windowMinutes: 30,
        maxSessionTrades: 2,
        confirmationCode: 'CONFIRM_AUTO_EXECUTION',
        operatorConsent: true,
      }),
    ).rejects.toThrow(/AUTONOMOUS_EXECUTION_BLOCKED/);
  });

  it('armAutonomous() succeeds when all gates pass and rejects invalid confirmation codes', async () => {
    // 1. Store valid broker token
    tokenStorage.storeToken({
      accessToken: 'test_access_token_123',
      expiresInSeconds: 86400,
      userId: 'UPSTOX_DEV_916',
      userType: 'individual',
    });

    // 2. Sign off Go-Live checklist
    (envService.config as any).LIVE_EXECUTION_ENABLED = true;
    checklistService.completeChecklist('Platform Owner John');
    expect(checklistService.isLiveExecutionPermitted()).toBe(true);

    const readiness = await autonomousService.checkReadiness();
    expect(readiness.isEligibleForAuto).toBe(true);
    expect(readiness.items.every((i) => i.passed)).toBe(true);

    // Reject wrong confirmation code
    await expect(
      autonomousService.armAutonomous({
        strategyId: TEST_STRATEGY_ID,
        windowMinutes: 30,
        maxSessionTrades: 2,
        confirmationCode: 'WRONG_CODE',
        operatorConsent: true,
      }),
    ).rejects.toThrow(/Invalid confirmation code/);

    // Valid arming
    const session = await autonomousService.armAutonomous({
      strategyId: TEST_STRATEGY_ID,
      windowMinutes: 30,
      maxSessionTrades: 2,
      confirmationCode: 'CONFIRM_AUTO_EXECUTION',
      operatorConsent: true,
    });

    expect(session.isArmed).toBe(true);
    expect(session.strategyId).toBe(TEST_STRATEGY_ID);
    expect(session.remainingMinutes).toBeGreaterThan(28);
    expect(session.maxSessionTrades).toBe(2);
    expect(session.tradesExecutedInSession).toBe(0);

    // Verify strategy status updated to ARMED
    const strategy = strategiesService.getStrategy(TEST_STRATEGY_ID);
    expect(strategy.status).toBe(StrategyStatus.ARMED);

    // Teardown: Disarm cleanly
    autonomousService.disarmAutonomous('Test clean disarm');
    expect(autonomousService.getSessionStatus().isArmed).toBe(false);
  });

  it('disarmAutonomous() resets strategy status, logs action, and creates alert', async () => {
    tokenStorage.storeToken({
      accessToken: 'test_token_123',
      expiresInSeconds: 86400,
      userId: 'UPSTOX_DEV_916',
      userType: 'individual',
    });
    (envService.config as any).LIVE_EXECUTION_ENABLED = true;
    checklistService.completeChecklist('Platform Owner John');

    await autonomousService.armAutonomous({
      strategyId: TEST_STRATEGY_ID,
      windowMinutes: 30,
      maxSessionTrades: 2,
      confirmationCode: 'CONFIRM_AUTO_EXECUTION',
      operatorConsent: true,
    });

    expect(autonomousService.getSessionStatus().isArmed).toBe(true);

    const disarmedStatus = autonomousService.disarmAutonomous('Operator Manual Intervention');
    expect(disarmedStatus.isArmed).toBe(false);
    expect(disarmedStatus.lastDisarmReason).toBe('Operator Manual Intervention');

    const logs = autonomousService.getExecutionLogs();
    expect(logs.length).toBeGreaterThan(0);
    const disarmLog = logs.find((l) => l.action === 'AUTO_DISARMED');
    expect(disarmLog).toBeDefined();
    expect(disarmLog?.details).toContain('Operator Manual Intervention');
  });

  it('executeAutonomousProposal() validates conditions and executes with GTT exits', async () => {
    tokenStorage.storeToken({
      accessToken: 'test_token_123',
      expiresInSeconds: 86400,
      userId: 'UPSTOX_DEV_916',
      userType: 'individual',
    });
    (envService.config as any).LIVE_EXECUTION_ENABLED = true;
    checklistService.completeChecklist('Platform Owner John');

    // Create a trade proposal
    const proposal: TradeProposal = {
      id: 'prop_auto_test_01',
      strategyId: TEST_STRATEGY_ID,
      strategyName: 'NIFTY EMA20 Momentum',
      strategyVersion: 1,
      versionHash: 'v1-test-hash',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY 25100 CE',
      optionType: AllowedOptionType.LONG_CALL,
      action: 'BUY',
      quantity: 25,
      suggestedEntryPrice: 122.5,
      estimatedCharges: 52.35,
      capitalRequired: 3062.5,
      allInRisk: 270.7,
      maxLossBuffer: 218.35,
      targetNetProfit: 300,
      stopLossPrice: 114.0,
      targetPrice: 136.0,
      status: ProposalStatus.PENDING,
      evidence: {
        ema20: 25050,
        rsi14: 62.4,
        spreadPct: 0.81,
        volume: 15000,
        candleCloseTime: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 180000).toISOString(),
    };

    proposalsService.addProposal(proposal);

    // Reject execution while DISARMED
    await expect(
      autonomousService.executeAutonomousProposal(proposal.id),
    ).rejects.toThrow(/Engine is DISARMED/);

    // Arm session with limit of 1 trade
    await autonomousService.armAutonomous({
      strategyId: TEST_STRATEGY_ID,
      windowMinutes: 30,
      maxSessionTrades: 1,
      confirmationCode: 'CONFIRM_AUTO_EXECUTION',
      operatorConsent: true,
    });

    // Execute proposal autonomously
    const execResult = await autonomousService.executeAutonomousProposal(proposal.id);
    expect(execResult.orderStatus).toBe(OrderStatus.PROTECTED);
    expect(execResult.protectionStatus).toBe(ExitProtectionStatus.PROTECTED_GTT);
    expect(execResult.filledQuantity).toBe(25);

    // Session trade cap of 1 reached -> verify auto-disarmed
    const status = autonomousService.getSessionStatus();
    expect(status.tradesExecutedInSession).toBe(1);
    expect(status.isArmed).toBe(false);
    expect(status.lastDisarmReason).toBe('SESSION_TRADE_CAP_REACHED');
  });

  it('blocks autonomous execution when Kill Switch is active', async () => {
    tokenStorage.storeToken({
      accessToken: 'test_token_123',
      expiresInSeconds: 86400,
      userId: 'UPSTOX_DEV_916',
      userType: 'individual',
    });
    (envService.config as any).LIVE_EXECUTION_ENABLED = true;
    checklistService.completeChecklist('Platform Owner John');

    // Engage kill switch
    reservationManager.setKillSwitch(true);

    // Arming should be rejected
    await expect(
      autonomousService.armAutonomous({
        strategyId: TEST_STRATEGY_ID,
        windowMinutes: 30,
        maxSessionTrades: 2,
        confirmationCode: 'CONFIRM_AUTO_EXECUTION',
        operatorConsent: true,
      }),
    ).rejects.toThrow(/Kill Switch is active/);

    reservationManager.setKillSwitch(false); // Cleanup
  });
});
