import { Injectable, Inject, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter } from './upstox-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { UpstoxOAuthService } from './upstox-oauth.service';
import { EventsGateway } from '../websocket/events.gateway';
import { EnvService } from '../config/env.service';
import { BrokerRouterService } from './broker-router.service';
import { LiveExecutionLedgerService } from './live-execution-ledger.service';
import {
  ReconciliationReport,
  ReconciliationDiscrepancy,
  Position,
  BrokerOrder,
} from '@trading-bot/contracts';

@Injectable()
export class BrokerReconciliationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BrokerReconciliationService.name);
  private latestReport: ReconciliationReport | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(PaperBrokerAdapter) private readonly localBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker: UpstoxBrokerAdapter,
    @Inject(RiskReservationManager) private readonly riskReservationManager: RiskReservationManager,
    @Inject(UpstoxOAuthService) private readonly oauthService: UpstoxOAuthService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(EnvService) _envService?: EnvService,
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
    @Optional() @Inject(LiveExecutionLedgerService) private readonly ledger?: LiveExecutionLedgerService,
  ) {}

  /**
   * On startup, run broker positions and ledger reconciliation before allowing trades.
   */
  async onApplicationBootstrap() {
    this.logger.log('[BrokerReconciliation] Running startup broker ledger reconciliation...');
    await this.runReconciliation();
    this.timer = setInterval(() => {
      if (!this.router?.isLive() || this.running) return;
      this.running = true;
      void this.runReconciliation().catch(() => this.riskReservationManager.setKillSwitch(true)).finally(() => { this.running = false; });
    }, 15000);
    this.timer.unref();
  }
  public onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /**
   * Performs an exhaustive reconciliation audit comparing local ledger against broker state.
   */
  public async runReconciliation(options: {
    mockBrokerPositions?: Position[];
    mockBrokerOrders?: BrokerOrder[];
  } = {}): Promise<ReconciliationReport> {
    const timestamp = new Date().toISOString();
    const discrepancies: ReconciliationDiscrepancy[] = [];

    // 1. Fetch Local App Ledger
    const live = this.router?.isLive() ?? false;
    if (live && (options.mockBrokerPositions || options.mockBrokerOrders)) throw new Error('Simulated reconciliation fixtures are restricted to Testing mode.');
    let localPositions = live ? this.ledger?.getPositions() || [] : await this.localBroker.getPositions();
    let localOrders = live ? this.ledger?.getOrders() || [] : await this.localBroker.getOrders();

    // 2. Fetch Remote Broker State (or fixtures for test)
    let brokerPositions: Position[] = [];
    let brokerOrders: BrokerOrder[] = [];

    try {
      if (options.mockBrokerPositions) {
        brokerPositions = options.mockBrokerPositions;
      } else {
        brokerPositions = live
          ? await this.upstoxBroker.getPositions()
          : await this.localBroker.getPositions();
      }

      if (options.mockBrokerOrders) {
        brokerOrders = options.mockBrokerOrders;
      } else {
        brokerOrders = live
          ? await this.upstoxBroker.getOrders()
          : await this.localBroker.getOrders();
      }
      if (live) {
        if (!this.ledger) throw new Error('Durable live ledger is missing.');
        this.ledger.observeOrders(brokerOrders);
        localPositions = this.ledger.getPositions(); localOrders = this.ledger.getOrders();
        for (const intent of this.ledger.getEntries()) {
          if (['SUBMITTING', 'UNKNOWN_BROKER_STATE', 'PROTECTION_FAILED'].includes(intent.state) || (intent.filledQuantity > 0 && intent.side === 'BUY' && intent.state !== 'CLOSED' && !intent.gttOrderId)) {
            discrepancies.push({ type: 'ORDER_MISMATCH', instrumentKey: intent.instrumentKey, brokerValue: null, localValue: intent.intentId,
              severity: 'CRITICAL', actionTaken: 'Live intent or protection remains unresolved; entries frozen.' });
          }
          if (intent.side === 'BUY' && intent.filledQuantity > 0 && intent.state !== 'CLOSED' && intent.gttOrderId) {
            await this.upstoxBroker.verifyProtectiveExit(intent.gttOrderId, intent.instrumentKey, intent.filledQuantity, intent.stopLossPrice!);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`[BrokerReconciliation] Remote broker read degraded: ${err.message}`);
      discrepancies.push({ type: 'ORDER_MISMATCH', instrumentKey: '*', brokerValue: 'UNAVAILABLE', localValue: null, severity: 'CRITICAL',
        actionTaken: 'Complete successful broker reads are required. Account state is unknown; entries frozen.' });
    }

    // 3. Position Matching
    const localPosMap = new Map<string, Position>();
    for (const lp of localPositions) {
      if (lp.netQuantity !== 0) {
        localPosMap.set(lp.instrumentKey, lp);
      }
    }

    const brokerPosMap = new Map<string, Position>();
    for (const bp of brokerPositions) {
      if (bp.netQuantity !== 0) {
        brokerPosMap.set(bp.instrumentKey, bp);
      }
    }

    // Check for Phantom Broker Positions (trades placed manually on broker app outside workstation)
    for (const [key, bp] of brokerPosMap.entries()) {
      const lp = localPosMap.get(key);
      if (!lp) {
        discrepancies.push({
          type: 'PHANTOM_BROKER_POSITION',
          instrumentKey: key,
          brokerValue: { symbol: bp.symbol, netQuantity: bp.netQuantity, buyAvg: bp.buyAvgPrice },
          localValue: null,
          severity: 'CRITICAL',
          actionTaken: 'Flagged phantom exposure. New trade entries frozen.',
        });
      } else if (lp.netQuantity !== bp.netQuantity) {
        discrepancies.push({
          type: 'POSITION_MISMATCH',
          instrumentKey: key,
          brokerValue: bp.netQuantity,
          localValue: lp.netQuantity,
          severity: 'CRITICAL',
          actionTaken: `Quantity divergence detected (Broker: ${bp.netQuantity}, Local: ${lp.netQuantity}). Execution frozen.`,
        });
      } else if (Math.abs(lp.buyAvgPrice - bp.buyAvgPrice) > 0.05) {
        discrepancies.push({
          type: 'PRICE_MISMATCH',
          instrumentKey: key,
          brokerValue: bp.buyAvgPrice,
          localValue: lp.buyAvgPrice,
          severity: 'WARNING',
          actionTaken: 'Average fill price divergence logged for review.',
        });
      }
    }

    // Check for positions tracked locally that broker doesn't have
    for (const [key, lp] of localPosMap.entries()) {
      if (!brokerPosMap.has(key)) {
        discrepancies.push({
          type: 'MISSING_LOCAL_RECORD',
          instrumentKey: key,
          brokerValue: null,
          localValue: { symbol: lp.symbol, netQuantity: lp.netQuantity },
          severity: 'CRITICAL',
          actionTaken: 'Local position missing from broker portfolio. Execution frozen.',
        });
      }
    }

    // 4. Order Mismatch Detection
    const localOrderIds = new Set(live ? this.ledger!.getEntries().flatMap((intent) => intent.orderIds) : localOrders.map((o) => o.brokerOrderId || o.id));
    for (const bo of brokerOrders) {
      const isTerminal = bo.status === 'FILLED' || bo.status === 'CANCELLED' || bo.status === 'REJECTED';
      if (!isTerminal && bo.brokerOrderId && !localOrderIds.has(bo.brokerOrderId)) {
        discrepancies.push({
          type: 'ORDER_MISMATCH',
          instrumentKey: bo.instrumentKey,
          brokerValue: { orderId: bo.brokerOrderId, status: bo.status, qty: bo.quantity },
          localValue: null,
          severity: 'CRITICAL',
          actionTaken: 'Unrecognized active broker order found. New entry submissions frozen.',
        });
      }
    }

    // 5. Freeze Enforcement If Discrepancies Found
    const hasCritical = discrepancies.some((d) => d.severity === 'CRITICAL');
    if (hasCritical) {
      this.logger.error(
        `[BrokerReconciliation] CRITICAL RECONCILIATION DISCREPANCIES DETECTED (${discrepancies.length}). Freezing trading engine.`,
      );
      this.riskReservationManager.setKillSwitch(true);
      this.gateway.broadcast('broker.reconciliation.mismatch', {
        timestamp,
        discrepanciesCount: discrepancies.length,
        discrepancies,
      });
    } else {
      this.logger.log(
        `[BrokerReconciliation] Reconciliation clean: ${localPositions.length} positions and ${localOrders.length} orders verified.`,
      );
      this.gateway.broadcast('broker.reconciliation.clean', { timestamp });
    }

    this.latestReport = {
      timestamp,
      status: hasCritical ? 'MISMATCH_DETECTED' : 'CLEAN',
      brokerPositionsCount: brokerPositions.length,
      localPositionsCount: localPositions.length,
      brokerOrdersCount: brokerOrders.length,
      localOrdersCount: localOrders.length,
      discrepancies,
      executionFrozen: hasCritical,
    };

    if (!hasCritical) this.oauthService.setLastReconciledAt(timestamp);

    return this.latestReport;
  }

  public getLatestReport(): ReconciliationReport {
    if (!this.latestReport) {
      return {
        timestamp: new Date().toISOString(),
        status: 'MISMATCH_DETECTED',
        brokerPositionsCount: 0,
        localPositionsCount: 0,
        brokerOrdersCount: 0,
        localOrdersCount: 0,
        discrepancies: [{ type: 'ORDER_MISMATCH', instrumentKey: '*', brokerValue: 'UNVERIFIED', localValue: null, severity: 'CRITICAL', actionTaken: 'Startup reconciliation has not completed.' }],
        executionFrozen: true,
      };
    }
    return this.latestReport;
  }
}
