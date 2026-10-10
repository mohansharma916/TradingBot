import 'reflect-metadata';
import { beforeEach, describe, it, expect } from 'vitest';
import { EnvService } from '../config/env.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { RiskService } from '../risk/risk.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { NotificationsService } from '../notifications/notifications.service';
import { ReconciliationSchedulerService } from '../broker/reconciliation-scheduler.service';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { UpstoxOAuthService } from '../broker/upstox-oauth.service';
import { ReportsService } from '../reports/reports.service';
import { HealthController } from '../health/health.controller';
import { OrdersService } from '../orders/orders.service';
import {
  RiskState,
  TradeMode,
  AlertSeverity,
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
  FeedStatus,
} from '@trading-bot/contracts';

describe('Operational Resilience & Diagnostics (Phase 6)', () => {
  const catalogService = new InstrumentCatalogService();
  const instrumentKey = 'NSE_FO|52175';
  beforeEach(() => {
    catalogService.bootstrapCatalog([{ segment: 'NSE_FO', instrument_type: 'CE', instrument_key: instrumentKey,
      trading_symbol: 'TEST_FIXTURE_65_CE', underlying_key: 'NSE_INDEX|Nifty 50', lot_size: 65,
      tick_size: 5, strike_price: 25000, expiry: Date.now() + 14 * 86400000 }]);
  });
  const mockFeed = {
    getQuote: (key: string) => ({
      instrumentKey: key,
      lastPrice: 126.5,
      bidPrice: 126.0,
      askPrice: 127.0,
      bidQty: 130,
      askQty: 130,
      volume: 10000,
      openInterest: 20000,
      provenance: 'SIMULATED',
      depthKnown: true,
      isStale: false,
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    }),
    getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 22, status: FeedStatus.CONNECTED,
      provenance: 'LIVE', lastTickReceivedAt: new Date().toISOString() }),
  };

  it('RiskService.resetKillSwitch() restores state to DISARMED and re-enables entries', () => {
    const envService = new EnvService();
    const gateway = { broadcast: () => {} } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const riskService = new RiskService(envService, reservationManager, undefined, undefined, gateway);

    // Engage kill switch
    riskService.triggerEmergencyStop();
    let status = riskService.getStatus();
    expect(status.state).toBe(RiskState.EMERGENCY_STOP);
    expect(status.killSwitchActive).toBe(true);

    // Reset kill switch
    status = riskService.resetKillSwitch();
    expect(status.state).toBe(RiskState.DISARMED);
    expect(status.killSwitchActive).toBe(false);
    expect(reservationManager.isKillSwitchActive()).toBe(false);
  });

  it('RiskService.flattenPositions() closes positions at market, settles reservations, and disarms', async () => {
    const envService = new EnvService();
    const broadcastEvents: Array<{ event: string; data: any }> = [];
    const gateway = {
      broadcast: (event: string, data: any) => {
        broadcastEvents.push({ event, data });
      },
    } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);
    reservationManager.arm(30);
    const reservation = reservationManager.acquireReservation({
      proposalId: 'prop_test_flatten_1',
      signalKey: 'sig_test_flatten_1',
      instrumentKey,
      capitalRequired: 9000,
      allInRisk: 300,
    });
    expect(reservationManager.getHeldReservationsCount()).toBe(1);
    const entry = await paperBroker.placeOrder({ intentId: reservation.id, tag: 'TEST', instrumentKey,
      side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: 65 });
    const entryOrder = (await paperBroker.getOrders()).find((order) => order.id === entry.orderId)!;
    expect(entryOrder.status).toBe(OrderStatus.FILLED);
    expect(entryOrder.filledQuantity).toBe(65);
    reservationManager.commitReservationToPosition(reservation.id, entryOrder.averageFillPrice * entryOrder.filledQuantity);
    expect(reservationManager.getOpenPositionsCount()).toBe(1);
    const ordersService = new OrdersService(paperBroker, reservationManager, {} as any, gateway);

    const riskService = new RiskService(
      envService,
      reservationManager,
      paperBroker,
      undefined,
      gateway,
      undefined,
      undefined,
      ordersService,
    );

    const result = await riskService.flattenPositions('Test manual emergency flatten drill');

    expect(result.success).toBe(true);
    expect(result.positionsClosed).toBe(1);
    expect(result.exitOrders).toHaveLength(1);
    expect(result.exitOrders[0]!.instrumentKey).toBe(instrumentKey);
    expect(result.exitOrders[0]!.status).toBe(OrderStatus.CLOSED);
    expect(riskService.getStatus().state).toBe(RiskState.DISARMED);

    // Verify all reservations are settled
    expect(reservationManager.getHeldReservationsCount()).toBe(0);
    expect(reservationManager.getActiveReservations()).toHaveLength(0);
    expect(reservationManager.getOpenPositionsCount()).toBe(0);

    // Verify positions in broker are now zero
    const remainingPositions = await paperBroker.getPositions();
    expect(remainingPositions.length).toBe(0);

    // All exit routes share confirmed fill settlement and this single event.
    const flattenEvt = broadcastEvents.find((e) => e.event === 'position.closed');
    expect(flattenEvt).toBeDefined();
    expect(flattenEvt?.data.instrumentKey).toBe(instrumentKey);
    expect(flattenEvt?.data.chargesSource).toBe('SIMULATED');
  });

  it('ReconciliationSchedulerService runs periodic reconciliations and broadcasts status', async () => {
    const envService = new EnvService();
    const broadcastEvents: Array<{ event: string; data: any }> = [];
    const gateway = {
      broadcast: (event: string, data: any) => {
        broadcastEvents.push({ event, data });
      },
    } as any;
    const tokenStorage = new TokenStorageService(envService);
    const oauthService = new UpstoxOAuthService(envService, tokenStorage, gateway);
    const paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);
    const upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);
    const reservationManager = new RiskReservationManager(envService, gateway);

    const reconciliationService = new BrokerReconciliationService(
      paperBroker,
      upstoxBroker,
      reservationManager,
      oauthService,
      gateway,
    );

    const scheduler = new ReconciliationSchedulerService(
      reconciliationService,
      gateway,
    );

    const report = await scheduler.runAuditCycle();
    expect(report).toBeDefined();
    expect(report.status).toBeDefined();

    const status = scheduler.getStatus();
    expect(status.schedulerActive).toBe(false); // not started via timer yet
    expect(status.totalRuns).toBe(1);
    expect(status.lastRunAt).toBeDefined();

    // Verify history recorded
    expect(scheduler.getHistory().length).toBe(1);

    // Verify startScheduler and stopScheduler
    scheduler.startScheduler(30);
    expect(scheduler.getStatus().schedulerActive).toBe(true);
    expect(scheduler.getStatus().intervalSeconds).toBe(30);

    scheduler.stopScheduler();
    expect(scheduler.getStatus().schedulerActive).toBe(false);
  });

  it('NotificationsService starts empty and records in-app dispatch and acknowledgment', () => {
    const broadcastEvents: Array<{ event: string; data: any }> = [];
    const gateway = {
      broadcast: (event: string, data: any) => {
        broadcastEvents.push({ event, data });
      },
    } as any;

    const notifService = new NotificationsService(gateway);
    expect(notifService.getAlerts()).toEqual([]);

    const alert1 = notifService.dispatchAlert({
      severity: AlertSeverity.WARNING,
      category: 'RISK_GATE',
      title: 'Approaching Risk Budget Limit',
      message: 'Daily loss at ₹380 / ₹500 cap.',
    });

    expect(alert1.id).toBeDefined();
    expect(alert1.acknowledged).toBe(false);
    expect(alert1.severity).toBe(AlertSeverity.WARNING);

    const activeAlerts = notifService.getAlerts();
    expect(activeAlerts).toHaveLength(1);
    expect(broadcastEvents.some((event) => event.event === 'alert.created' && event.data.id === alert1.id)).toBe(true);

    const ack = notifService.acknowledgeAlert(alert1.id);
    expect(ack.acknowledged).toBe(true);

    // Verify trigger Drill Alert
    const drillAlert = notifService.triggerDrillAlert(AlertSeverity.EMERGENCY);
    expect(drillAlert.category).toBe('SYSTEM');
    expect(drillAlert.severity).toBe(AlertSeverity.EMERGENCY);
    expect(drillAlert.title).toContain('Drill');
    expect(drillAlert.message).toContain('in-app alert delivery');
  });

  it('ReportsService leaves an empty ledger at zero and exports quoted fee/source columns', async () => {
    const envService = new EnvService();
    const gateway = { broadcast: () => {} } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);

    const broker = { isLive: () => false, getFills: () => paperBroker.getFills(), getPositions: () => paperBroker.getPositions() };
    const reportsService = new ReportsService(broker as any, reservationManager);

    const report = await reportsService.getDailyReport();
    expect(report.mode).toBe(TradeMode.PAPER);
    expect(report.totalTrades).toBe(0);
    expect(report.realizedGrossPnl).toBe(0);
    expect(report.realizedNetPnl).toBe(0);
    expect(report.actualCharges).toBe(0);
    expect(report.capitalDeployed).toBe(0);
    expect(report.dataSource).toBe('PAPER_SIMULATION');
    expect(report.chargesSource).toBe('SIMULATED');

    const csvExport = reportsService.generateCsvExport();
    expect(csvExport.filename).toMatch(/^trading-fills-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvExport.csvContent).toBe('"Fill ID","Timestamp","Instrument Key","Side","Quantity","Fill Price (INR)","Estimated Fees (INR)","Reported Fees (INR)","Fees Source"');
    expect(csvExport.csvContent).not.toContain('Fee Variance Savings');
  });

  it('HealthController.getDiagnostics() produces full telemetry report', async () => {
    const envService = new EnvService();
    const gateway = { broadcast: () => {} } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);
    const tokenStorage = new TokenStorageService(envService);
    const oauthService = new UpstoxOAuthService(envService, tokenStorage, gateway);
    const upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);
    const reconciliationService = new BrokerReconciliationService(
      paperBroker,
      upstoxBroker,
      reservationManager,
      oauthService,
      gateway,
    );
    const scheduler = new ReconciliationSchedulerService(reconciliationService, gateway);
    const riskService = new RiskService(envService, reservationManager, paperBroker, upstoxBroker, gateway);

    const healthController = new HealthController(
      envService,
      mockFeed as any,
      tokenStorage,
      riskService,
      scheduler,
    );

    const diag = healthController.getDiagnostics();
    expect(diag.systemMode).toBe(TradeMode.PAPER);
    expect(diag.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(diag.memoryUsageMb).toBeGreaterThan(0);
    expect(diag.marketFeed.connected).toBe(true);
    expect(diag.marketFeed.latencyMs).toBe(22);
    expect(diag.marketFeed.lastTickAt).not.toBeNull();
    expect(diag.brokerConnection.egressIpMatch).toBeNull();
    expect(diag.brokerConnection.rateLimiterTokensRemaining).toBeNull();
    expect(diag.riskStatus.riskState).toBe(RiskState.DISARMED);
    expect(diag.riskStatus.killSwitchActive).toBe(false);
    expect(diag.reconciliation.activeScheduler).toBe(false);
  });

  it('HealthController keeps unavailable feed telemetry and readiness explicitly degraded', () => {
    const envService = new EnvService();
    const feed = { getFeedHealth: () => ({ status: FeedStatus.DISCONNECTED, provenance: 'UNAVAILABLE',
      feedLatencyMs: 0, staleCount: 0, lastTickReceivedAt: null }) };
    const tokenStorage = { getTokenMetadata: () => ({ exists: false, isExpired: false, secondsRemaining: 0 }), hasValidToken: () => false };
    const risk = { getStatus: () => ({ state: RiskState.DISARMED, killSwitchActive: false,
      availableCash: 0, reservedCapital: 0, remainingDailyRiskBudget: 0, openPositionsCount: 0 }) };
    const scheduler = { getStatus: () => ({ schedulerActive: false, lastRunAt: null, lastDiscrepanciesFound: 0 }) };
    const mode = { getMode: () => TradeMode.PAPER, isLive: () => false };
    const health = new HealthController(envService, feed as any, tokenStorage as any, risk as any, scheduler as any, mode as any, { isOwner: () => false } as any);
    const diagnostics = health.getDiagnostics();
    expect(diagnostics.marketFeed.connected).toBe(false);
    expect(diagnostics.marketFeed.lastTickAt).toBeNull();
    expect(diagnostics.brokerConnection.authenticated).toBe(false);
    expect(diagnostics.brokerConnection.egressIpMatch).toBeNull();
    expect(diagnostics.brokerConnection.rateLimiterTokensRemaining).toBeNull();
    const readiness = health.getReady();
    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.genuineFeedAvailable).toBe(false);
    expect(readiness.checks.accountRuntimeOwned).toBe(false);
    expect(readiness.checks).not.toHaveProperty('database');
    expect(readiness.checks).not.toHaveProperty('worker');
  });
});
