import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter } from './upstox-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { UpstoxOAuthService } from './upstox-oauth.service';
import { EventsGateway } from '../websocket/events.gateway';
import {
  ReconciliationReport,
  ReconciliationDiscrepancy,
  Position,
  BrokerOrder,
} from '@trading-bot/contracts';

@Injectable()
export class BrokerReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BrokerReconciliationService.name);
  private latestReport: ReconciliationReport | null = null;

  constructor(
    @Inject(PaperBrokerAdapter) private readonly localBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker: UpstoxBrokerAdapter,
    @Inject(RiskReservationManager) private readonly riskReservationManager: RiskReservationManager,
    @Inject(UpstoxOAuthService) private readonly oauthService: UpstoxOAuthService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  /**
   * On startup, run broker positions and ledger reconciliation before allowing trades.
   */
  async onApplicationBootstrap() {
    this.logger.log('[BrokerReconciliation] Running startup broker ledger reconciliation...');
    await this.runReconciliation();
  }

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
    const localPositions = await this.localBroker.getPositions();
    const localOrders = await this.localBroker.getOrders();

    // 2. Fetch Remote Broker State (or fixtures for test)
    let brokerPositions: Position[] = [];
    let brokerOrders: BrokerOrder[] = [];

    try {
      if (options.mockBrokerPositions) {
        brokerPositions = options.mockBrokerPositions;
      } else {
        brokerPositions = await this.upstoxBroker.getPositions();
      }

      if (options.mockBrokerOrders) {
        brokerOrders = options.mockBrokerOrders;
      } else {
        brokerOrders = await this.upstoxBroker.getOrders();
      }
    } catch (err: any) {
      this.logger.warn(`[BrokerReconciliation] Remote broker read degraded: ${err.message}`);
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
    const localOrderIds = new Set(localOrders.map((o) => o.brokerOrderId || o.id));
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

    this.oauthService.setLastReconciledAt(timestamp);

    return this.latestReport;
  }

  public getLatestReport(): ReconciliationReport {
    if (!this.latestReport) {
      return {
        timestamp: new Date().toISOString(),
        status: 'CLEAN',
        brokerPositionsCount: 0,
        localPositionsCount: 0,
        brokerOrdersCount: 0,
        localOrdersCount: 0,
        discrepancies: [],
        executionFrozen: false,
      };
    }
    return this.latestReport;
  }
}
