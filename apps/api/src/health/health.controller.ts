import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { TradingModeService } from '../trading/trading-mode.service';
import { RuntimeLeaseService } from '../trading/runtime-lease.service';
import { EnvService } from '../config/env.service';
import { DiagnosticsReport } from '@trading-bot/contracts';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { RiskService } from '../risk/risk.service';
import { ReconciliationSchedulerService } from '../broker/reconciliation-scheduler.service';

@Controller('health')
export class HealthController {
  private startTime = Date.now();

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(UpstoxMarketFeedService) private readonly marketFeed: UpstoxMarketFeedService,
    @Inject(TokenStorageService) private readonly tokenStorage: TokenStorageService,
    @Inject(RiskService) private readonly riskService: RiskService,
    @Inject(ReconciliationSchedulerService) private readonly reconciliationScheduler: ReconciliationSchedulerService,
    @Optional() @Inject(TradingModeService) private readonly mode?: TradingModeService,
    @Optional() @Inject(RuntimeLeaseService) private readonly lease?: RuntimeLeaseService,
  ) {}

  @Get('live')
  getLive() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      service: 'trading-api',
      mode: this.mode?.getMode() ?? this.envService.config.SYSTEM_MODE,
    };
  }

  @Get('ready')
  getReady() {
    const checks = {
      ownerLoginConfigured: Boolean(this.envService.config.OWNER_PASSWORD),
      accountRuntimeOwned: this.lease?.isOwner() ?? false,
      brokerSessionAvailable: !this.mode?.isLive() || this.tokenStorage.hasValidToken(),
      genuineFeedAvailable: this.marketFeed.getFeedHealth().provenance === 'LIVE',
    };
    return {status: Object.values(checks).every(Boolean) ? 'ready' : 'degraded', checks, timestamp:new Date().toISOString()};
  }

  @Get('diagnostics')
  getDiagnostics(): DiagnosticsReport {
    const memory = process.memoryUsage();
    const feedHealth = this.marketFeed.getFeedHealth();
    const tokenMeta = this.tokenStorage.getTokenMetadata();
    const riskStatus = this.riskService.getStatus();
    const scheduleStatus = this.reconciliationScheduler.getStatus();

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsageMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
      systemMode: this.mode?.getMode() ?? this.envService.config.SYSTEM_MODE,
      marketFeed: {
        connected: feedHealth.status === 'CONNECTED' && feedHealth.provenance === 'LIVE',
        latencyMs: feedHealth.feedLatencyMs,
        staleTicksCount: feedHealth.staleCount,
        lastTickAt: feedHealth.lastTickReceivedAt ?? null,
      },
      brokerConnection: {
        authenticated: tokenMeta.exists && !tokenMeta.isExpired,
        rateLimiterTokensRemaining: null,
        egressIpMatch: null,
        registeredIp: this.envService.config.UPSTOX_EGRESS_IP,
        tokenExpiresInSeconds: tokenMeta.secondsRemaining,
      },
      riskStatus: {
        killSwitchActive: riskStatus.killSwitchActive,
        riskState: riskStatus.state,
        availableCash: riskStatus.availableCash,
        reservedCapital: riskStatus.reservedCapital,
        dailyDrawdownBudgetRemaining: riskStatus.remainingDailyRiskBudget,
        openPositionsCount: riskStatus.openPositionsCount,
      },
      reconciliation: {
        activeScheduler: scheduleStatus.schedulerActive,
        lastReconciliationAt: scheduleStatus.lastRunAt,
        discrepancyCount: scheduleStatus.lastDiscrepanciesFound,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
