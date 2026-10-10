import {
  Injectable,
  Inject,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import {
  AutonomousReadinessReport,
  AutonomousArmRequest,
  AutonomousSessionStatus,
  AutonomousExecutionLog,
  StrategyStatus,
  AlertSeverity,
  TradeMode,
  SupervisedExecutionResult,
} from '@trading-bot/contracts';
import { EnvService } from '../config/env.service';
import { GoLiveChecklistService } from './go-live-checklist.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { StrategiesService } from '../strategies/strategies.service';
import { SupervisedExecutionService } from './supervised-execution.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { EventsGateway } from '../websocket/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ProposalsService } from '../proposals/proposals.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import crypto from 'node:crypto';
import { TradingModeService } from '../trading/trading-mode.service';

@Injectable()
export class AutonomousExecutionService {
  private readonly logger = new Logger(AutonomousExecutionService.name);

  private isArmed = false;
  private armedStrategyId: string | null = null;
  private armedStrategyName: string | null = null;
  private armedStrategyVersion: number | null = null;
  private armedVersionHash: string | null = null;
  private armedAt: string | null = null;
  private armedUntil: string | null = null;
  private maxSessionTrades = 2;
  private tradesExecutedInSession = 0;
  private lastDisarmReason: string | null = null;
  private disarmTimer: NodeJS.Timeout | null = null;
  private executionLogs: AutonomousExecutionLog[] = [];

  constructor(
    @Inject(EnvService) _envService: EnvService,
    @Inject(GoLiveChecklistService) private readonly checklistService: GoLiveChecklistService,
    @Inject(BrokerReconciliationService) private readonly reconciliationService: BrokerReconciliationService,
    @Inject(TokenStorageService) private readonly tokenStorage: TokenStorageService,
    @Inject(UpstoxMarketFeedService) private readonly marketFeed: UpstoxMarketFeedService,
    @Inject(StrategiesService) private readonly strategiesService: StrategiesService,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Inject(SupervisedExecutionService) private readonly supervisedExecution: SupervisedExecutionService,
    @Inject(RiskReservationManager) private readonly reservationManager: RiskReservationManager,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PaperBrokerAdapter) private readonly paperBroker?: PaperBrokerAdapter,
    @Optional() @Inject(TradingModeService) private readonly mode?: TradingModeService,
  ) {}

  /**
   * Pre-Flight Autonomous Readiness Audit:
   * Strict regulatory, risk, broker, paper, and infrastructure verification.
   * Reference: Blueprint Section 20 & Phase 7
   */
  public async checkReadiness(): Promise<AutonomousReadinessReport> {
    const now = new Date().toISOString();
    const tokenMeta = this.tokenStorage.getTokenMetadata();
    const feedHealth = this.marketFeed.getFeedHealth();
    const live = this.mode?.isLive() ?? false;
    const checklist = this.checklistService.getChecklist();
    const paperFills = this.paperBroker?.getFills() ?? [];
    const completedPaperDays = new Set(paperFills.filter(fill => fill.side === 'SELL' && paperFills.some(buy => buy.side === 'BUY' && buy.instrumentKey === fill.instrumentKey && Date.parse(buy.timestamp) < Date.parse(fill.timestamp))).map(fill => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(fill.timestamp))));
    const isLivePermitted = this.checklistService.isLiveExecutionPermitted();

    // 1. Regulatory: Personal algorithmic trading compliance with bounded session window
    const regCheck = {
      id: 'auto_01',
      title: 'Owner broker requirements review',
      description: 'Supervised personal execution with time-bound session windows and hard risk caps.',
      category: 'REGULATORY' as const,
      passed: !live || checklist.items.some(item => item.id === 'chk_01_reg' && item.passed && Boolean(item.evidence)) && Boolean(checklist.signedOffAt),
      details: live ? 'Requires recorded owner review; software does not certify regulatory compliance.' : 'Testing executes virtual funds; live broker permissions are reviewed before Live use.',
      verifiedAt: now,
    };

    // 2. Paper Proof: Multi-day paper execution verification
    const paperCheck = {
      id: 'auto_02',
      title: 'Multi-Day Paper Proof Verification',
      description: 'Verified minimum clean paper simulation runs without unhandled exceptions.',
      category: 'PAPER_PROOF' as const,
      passed: !live || completedPaperDays.size >= 2,
      details: `${completedPaperDays.size} distinct days contain matched paper entry/exit records. Paper fees are modeled; these records do not establish profitability.`,
      verifiedAt: now,
    };

    // 3. Go-Live 10-point checklist
    const goLiveCheck = {
      id: 'auto_03',
      title: '10-Point Pre-Flight Go-Live Verification',
      description: 'Owner signed-off pre-flight checklist covering risk caps, static IP, and disclosure.',
      category: 'GO_LIVE' as const,
      passed: !live || isLivePermitted,
      details: isLivePermitted
        ? 'Go-Live checklist 10/10 verified and signed off by platform owner.'
        : 'Go-Live checklist pending owner sign-off. Live auto blocked.',
      verifiedAt: now,
    };

    // 4. Broker Reconciliation
    let reconClean = true;
    let reconDetails = 'Zero broker discrepancies detected across positions and orders.';
    try {
      const isPaper = !live;
      const paperPositions = this.paperBroker ? await this.paperBroker.getPositions() : undefined;
      const paperOrders = this.paperBroker ? await this.paperBroker.getOrders() : undefined;
      const recon = isPaper && paperPositions
        ? await this.reconciliationService.runReconciliation({
            mockBrokerPositions: paperPositions,
            mockBrokerOrders: paperOrders || [],
          })
        : await this.reconciliationService.runReconciliation();

      if (recon.discrepancies.length > 0) {
        reconClean = false;
        reconDetails = `${recon.discrepancies.length} discrepancy found between local and broker ledger.`;
      }
    } catch {
      reconClean = false;
      reconDetails = 'Failed to execute broker reconciliation audit.';
    }

    const reconCheck = {
      id: 'auto_04',
      title: 'Broker Order & Position Reconciliation',
      description: 'Local and broker state synchronized with 0 phantom or divergent exposures.',
      category: 'RECONCILIATION' as const,
      passed: reconClean,
      details: reconDetails,
      verifiedAt: now,
    };

    // 5. Broker OAuth 2.0 Auth
    const tokenOk = tokenMeta.exists && !tokenMeta.isExpired && (tokenMeta.secondsRemaining || 0) > 900;
    const authCheck = {
      id: 'auto_05',
      title: 'Broker OAuth 2.0 Token Validity',
      description: 'AES-256-GCM encrypted Upstox token valid with > 15 minutes remaining.',
      category: 'BROKER_AUTH' as const,
      passed: !live || tokenOk,
      details: tokenOk
        ? `Token valid for ${Math.floor((tokenMeta.secondsRemaining || 0) / 60)} minutes.`
        : 'Broker token expired or missing. Auto execution blocked.',
      verifiedAt: now,
    };

    // 6. Streaming Market Feed Health
    const feedOk = feedHealth.status === 'CONNECTED' && feedHealth.provenance === 'LIVE' && feedHealth.totalTicksReceived > 0 && feedHealth.staleCount === 0 && feedHealth.feedLatencyMs < 3000;
    const feedCheck = {
      id: 'auto_06',
      title: 'Streaming Market Data Feed Freshness',
      description: 'Protobuf V3 WebSocket latency < 3,000ms with zero stale ticks.',
      category: 'FEED_HEALTH' as const,
      passed: feedOk,
      details: `Latency: ${feedHealth.feedLatencyMs}ms, Stale Ticks: ${feedHealth.staleCount}.`,
      verifiedAt: now,
    };

    const items = [regCheck, paperCheck, goLiveCheck, reconCheck, authCheck, feedCheck];
    const isEligibleForAuto = items.every((i) => i.passed);

    return {
      isEligibleForAuto,
      items,
      evaluatedAt: now,
      summary: isEligibleForAuto
        ? 'All 6 Autonomous Readiness Gates PASSED. System is eligible for bounded arming.'
        : 'One or more Autonomous Readiness Gates FAILED. Auto execution blocked.',
    };
  }

  /**
   * Arms a strategy for a bounded time window with per-session trade limits.
   * Reference: Blueprint Section 20 & Phase 7
   */
  public async armAutonomous(dto: AutonomousArmRequest): Promise<AutonomousSessionStatus> {
    const readiness = await this.checkReadiness();
    if (!readiness.isEligibleForAuto) {
      const failing = readiness.items.filter((i) => !i.passed).map((i) => i.title).join(', ');
      throw new ForbiddenException(
        `AUTONOMOUS_EXECUTION_BLOCKED: Prerequisites missing (${failing}). Auto execution cannot be armed.`,
      );
    }

    if (!dto.operatorConsent || dto.confirmationCode !== 'CONFIRM_AUTO_EXECUTION') {
      throw new BadRequestException(
        `Invalid confirmation code. Operator must specify 'CONFIRM_AUTO_EXECUTION'.`,
      );
    }

    if (this.reservationManager.isKillSwitchActive()) {
      throw new ForbiddenException('Cannot arm autonomous mode while Kill Switch is active.');
    }

    const strategy = this.strategiesService.getStrategy(dto.strategyId);
    if (!strategy) {
      throw new NotFoundException(`Strategy '${dto.strategyId}' not found.`);
    }

    // Set strategy status to ARMED
    this.strategiesService.updateStrategy(strategy.id, {
      status: StrategyStatus.ARMED,
    });

    this.reservationManager.arm(dto.windowMinutes);
    const now = Date.now();
    const durationMs = dto.windowMinutes * 60 * 1000;
    const armedUntilDate = new Date(now + durationMs);

    this.isArmed = true;
    this.armedStrategyId = strategy.id;
    this.armedStrategyName = strategy.name;
    this.armedStrategyVersion = strategy.version;
    this.armedVersionHash = strategy.versionHash || null;
    this.armedAt = new Date(now).toISOString();
    this.armedUntil = armedUntilDate.toISOString();
    this.maxSessionTrades = dto.maxSessionTrades;
    this.tradesExecutedInSession = 0;
    this.lastDisarmReason = null;

    // Clear any previous timer
    if (this.disarmTimer) {
      clearTimeout(this.disarmTimer);
    }

    // Schedule automatic disarm upon window expiration
    this.disarmTimer = setTimeout(() => {
      this.disarmAutonomous('ARMED_WINDOW_EXPIRED');
    }, durationMs);

    this.recordLog(
      strategy.id,
      strategy.versionHash || 'unknown',
      'AUTO_TRIGGERED',
      `Strategy '${strategy.name}' ARMED for ${dto.windowMinutes} minutes. Max session trades: ${dto.maxSessionTrades}.`,
      true,
    );

    this.logger.warn(
      `[AutonomousExecution] Strategy '${strategy.name}' (v${strategy.version}) ARMED until ${this.armedUntil}. Session limit: ${this.maxSessionTrades} trades.`,
    );

    this.notifications.dispatchAlert({
      severity: AlertSeverity.WARNING,
      category: 'SYSTEM',
      title: 'Autonomous Trading Mode ARMED',
      message: `Strategy '${strategy.name}' armed for ${dto.windowMinutes}m. Hard caps: ₹10k capital, ₹500 risk, max ${dto.maxSessionTrades} trades.`,
    });

    const status = this.getSessionStatus();
    this.gateway.broadcast('autonomous.armed', status);
    return status;
  }

  /**
   * Disarms the active autonomous session safely.
   */
  public disarmAutonomous(reason = 'Operator Manual Disarm'): AutonomousSessionStatus {
    if (this.disarmTimer) {
      clearTimeout(this.disarmTimer);
      this.disarmTimer = null;
    }

    const previousStrategyId = this.armedStrategyId;
    const previousVersionHash = this.armedVersionHash;

    this.isArmed = false;
    this.reservationManager.disarm();
    this.lastDisarmReason = reason;

    if (previousStrategyId) {
      try {
        this.strategiesService.updateStrategy(previousStrategyId, {
          status: StrategyStatus.DRAFT,
        });
      } catch {
        // Safe fallback
      }
    }

    this.recordLog(
      previousStrategyId || 'none',
      previousVersionHash || 'none',
      'AUTO_DISARMED',
      `Autonomous session disarmed. Reason: ${reason}. Trades executed: ${this.tradesExecutedInSession}/${this.maxSessionTrades}.`,
      true,
    );

    this.logger.log(`[AutonomousExecution] Session DISARMED. Reason: ${reason}.`);

    this.notifications.dispatchAlert({
      severity: AlertSeverity.INFO,
      category: 'SYSTEM',
      title: 'Autonomous Session Disarmed',
      message: `Trading engine disarmed safely. Reason: ${reason}.`,
    });

    const status = this.getSessionStatus();
    this.gateway.broadcast('autonomous.disarmed', status);
    return status;
  }

  /**
   * Executes a trade proposal autonomously if armed conditions are strictly satisfied.
   */
  public async executeAutonomousProposal(proposalId: string): Promise<SupervisedExecutionResult> {
    if (!this.isArmed) {
      throw new ForbiddenException('Autonomous execution rejected: Engine is DISARMED.');
    }

    // Check expiration
    if (this.armedUntil && Date.now() >= new Date(this.armedUntil).getTime()) {
      this.disarmAutonomous('ARMED_WINDOW_EXPIRED');
      throw new ForbiddenException('Autonomous execution rejected: Armed time window has expired.');
    }

    // Check session trade cap
    if (this.tradesExecutedInSession >= this.maxSessionTrades) {
      this.disarmAutonomous('SESSION_TRADE_CAP_REACHED');
      throw new ForbiddenException(
        `Autonomous execution rejected: Session trade cap of ${this.maxSessionTrades} trades reached.`,
      );
    }

    // Check kill switch
    if (this.reservationManager.isKillSwitchActive()) {
      this.disarmAutonomous('KILL_SWITCH_ENGAGED');
      throw new ForbiddenException('Autonomous execution rejected: Kill switch is ACTIVE.');
    }

    this.reservationManager.assertEntryAllowed();
    const proposal = this.proposalsService.getProposal(proposalId);
    const armedStrategy = this.armedStrategyId ? this.strategiesService.getStrategy(this.armedStrategyId) : null;
    if (!proposal || !armedStrategy || proposal.strategyId !== armedStrategy.id || proposal.strategyVersion !== this.armedStrategyVersion || proposal.versionHash !== this.armedVersionHash || armedStrategy.versionHash !== this.armedVersionHash) {
      this.disarmAutonomous('STRATEGY_VERSION_MISMATCH');
      throw new ForbiddenException('Proposal must match the exact armed strategy and version hash.');
    }
    this.recordLog(
      this.armedStrategyId || 'unknown',
      this.armedVersionHash || 'unknown',
      'PRE_TRADE_VALIDATED',
      `Auto execution triggered for proposal ${proposalId}. Pre-trade validation starting.`,
      true,
    );

    // Approve proposal and delegate to SupervisedExecutionService
    // SupervisedExecutionService automatically validates spread <= 1.0%, quote freshness < 3,000ms, locks capital, and attaches GTT exits.
    try {
      this.proposalsService.approveProposal(proposalId);
      const result = await this.supervisedExecution.executeSupervisedProposal({
        proposalId,
        revalidateFreshness: true,
      });
      if (result.filledQuantity > 0) this.tradesExecutedInSession++;

      this.recordLog(
        this.armedStrategyId || 'unknown',
        this.armedVersionHash || 'unknown',
        'ORDER_DISPATCHED',
        `Autonomous order executed: Order ID ${result.orderId}. Broker state: ${result.orderStatus}; protection: ${result.protectionStatus}. Session trades: ${this.tradesExecutedInSession}/${this.maxSessionTrades}.`,
        true,
      );

      // Auto disarm if session cap reached
      if (this.tradesExecutedInSession >= this.maxSessionTrades) {
        this.disarmAutonomous('SESSION_TRADE_CAP_REACHED');
      }

      this.gateway.broadcast('autonomous.executed', {
        proposalId,
        orderId: result.orderId,
        sessionTrades: this.tradesExecutedInSession,
      });

      return result;
    } catch (err: any) {
      this.recordLog(
        this.armedStrategyId || 'unknown',
        this.armedVersionHash || 'unknown',
        'AUTO_BLOCKED',
        `Autonomous execution failed: ${err.message}. Disarming engine for safety.`,
        false,
      );
      this.disarmAutonomous(`EXECUTION_ERROR: ${err.message}`);
      throw err;
    }
  }

  public getSessionStatus(): AutonomousSessionStatus {
    let remainingMinutes = 0;
    if (this.isArmed && this.armedUntil) {
      const remainingMs = Math.max(0, new Date(this.armedUntil).getTime() - Date.now());
      remainingMinutes = Number((remainingMs / 60000).toFixed(1));
      if (remainingMinutes === 0) {
        this.disarmAutonomous('ARMED_WINDOW_EXPIRED');
      }
    }

    return {
      isArmed: this.isArmed,
      strategyId: this.armedStrategyId,
      strategyName: this.armedStrategyName,
      strategyVersion: this.armedStrategyVersion,
      versionHash: this.armedVersionHash,
      armedAt: this.armedAt,
      armedUntil: this.armedUntil,
      remainingMinutes,
      tradesExecutedInSession: this.tradesExecutedInSession,
      maxSessionTrades: this.maxSessionTrades,
      lastDisarmReason: this.lastDisarmReason,
      systemMode: this.mode?.getMode() ?? TradeMode.PAPER,
    };
  }

  public getExecutionLogs(): AutonomousExecutionLog[] {
    return [...this.executionLogs];
  }

  private recordLog(
    strategyId: string,
    versionHash: string,
    action: AutonomousExecutionLog['action'],
    details: string,
    riskChecksPassed: boolean,
  ): void {
    const log: AutonomousExecutionLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      strategyId,
      versionHash,
      action,
      details,
      riskChecksPassed,
    };
    this.executionLogs.unshift(log);
    if (this.executionLogs.length > 50) {
      this.executionLogs.pop();
    }
  }
}
