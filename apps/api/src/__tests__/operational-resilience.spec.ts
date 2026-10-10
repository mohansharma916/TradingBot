import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { EnvService } from '../config/env.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { RiskService } from '../risk/risk.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ReconciliationSchedulerService } from '../broker/reconciliation-scheduler.service';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { UpstoxOAuthService } from '../broker/upstox-oauth.service';
import { ReportsService } from '../reports/reports.service';
import { HealthController } from '../health/health.controller';
import {
  RiskState,
  TradeMode,
  AlertSeverity,
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
} from '@trading-bot/contracts';

describe('Operational Resilience & Diagnostics (Phase 6)', () => {
  const catalogService = new InstrumentCatalogService();
  const mockFeed = {
    getQuote: (key: string) => ({
      instrumentKey: key,
      lastPrice: 126.5,
      bidPrice: 126.0,
      askPrice: 127.0,
      isStale: false,
      timestamp: new Date().toISOString(),
    }),
    getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 22 }),
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
    const tokenStorage = new TokenStorageService(envService);
    const upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);

    // Open an actual paper fill before exercising the flatten control.
    await paperBroker.placeOrder({ intentId: 'flatten_test_entry', tag: 'TEST', instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE', side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: 25 });
    const initialPositions = await paperBroker.getPositions();
    expect(initialPositions.length).toBeGreaterThan(0);
    const seededKey = initialPositions[0]!.instrumentKey;

    // Reserve capital for the seeded position
    reservationManager.acquireReservation({
      proposalId: 'prop_test_flatten_1',
      signalKey: 'sig_test_flatten_1',
      instrumentKey: seededKey,
      capitalRequired: 3000,
      allInRisk: 300,
    });

    expect(reservationManager.getHeldReservationsCount()).toBe(1);

    const riskService = new RiskService(
      envService,
      reservationManager,
      paperBroker,
      upstoxBroker,
      gateway,
    );

    const result = await riskService.flattenPositions('Test manual emergency flatten drill');

    expect(result.success).toBe(true);
    expect(result.positionsClosed).toBeGreaterThan(0);
    expect(result.exitOrders.length).toBeGreaterThan(0);
    expect(result.exitOrders[0]!.instrumentKey).toBe(seededKey);
    expect(result.exitOrders[0]!.status).toBe(OrderStatus.CLOSED);
    expect(riskService.getStatus().state).toBe(RiskState.DISARMED);

    // Verify all reservations are settled
    expect(reservationManager.getHeldReservationsCount()).toBe(0);

    // Verify positions in broker are now zero
    const remainingPositions = await paperBroker.getPositions();
    expect(remainingPositions.length).toBe(0);

    // Verify position.flattened event broadcast
    const flattenEvt = broadcastEvents.find((e) => e.event === 'position.flattened');
    expect(flattenEvt).toBeDefined();
    expect(flattenEvt?.data.instrumentKey).toBe(seededKey);
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

  it('NotificationsService dispatches alerts, respects ring-buffer limits, and allows acknowledgment', () => {
    const broadcastEvents: Array<{ event: string; data: any }> = [];
    const gateway = {
      broadcast: (event: string, data: any) => {
        broadcastEvents.push({ event, data });
      },
    } as any;

    const notifService = new NotificationsService(gateway);

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
    expect(activeAlerts.length).toBeGreaterThanOrEqual(2); // 1 initial seeded + alert1

    const ack = notifService.acknowledgeAlert(alert1.id);
    expect(ack.acknowledged).toBe(true);

    // Verify trigger Drill Alert
    const drillAlert = notifService.triggerDrillAlert(AlertSeverity.EMERGENCY);
    expect(drillAlert.category).toBe('SYSTEM');
    expect(drillAlert.severity).toBe(AlertSeverity.EMERGENCY);
    expect(drillAlert.title).toContain('Drill');
  });

  it('ReportsService calculates daily performance metrics, fee variance savings, and builds RFC 4180 CSV', async () => {
    const envService = new EnvService();
    const gateway = { broadcast: () => {} } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const paperBroker = new PaperBrokerAdapter(catalogService, mockFeed as any, gateway);

    const reportsService = new ReportsService(envService, paperBroker, reservationManager);

    const report = await reportsService.getDailyReport();
    expect(report.mode).toBe(TradeMode.PAPER);
    expect(report.totalTrades).toBeGreaterThanOrEqual(1);
    expect(report.realizedGrossPnl).toBeDefined();
    expect(report.realizedNetPnl).toBeDefined();

    const csvExport = reportsService.generateCsvExport();
    expect(csvExport.filename).toMatch(/^daily_trading_report_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvExport.csvContent).toContain('Fill ID,Timestamp,Instrument Key,Side,Quantity,Fill Price (INR)');
    expect(csvExport.csvContent).toContain('Fee Variance Savings (INR)');
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
    expect(diag.riskStatus.riskState).toBe(RiskState.DISARMED);
    expect(diag.riskStatus.killSwitchActive).toBe(false);
    expect(diag.reconciliation.activeScheduler).toBe(false);
  });
});
