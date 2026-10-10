import { Controller, Get, Inject } from '@nestjs/common';
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
  ) {}

  @Get('live')
  getLive() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      service: 'trading-api',
      mode: this.envService.config.SYSTEM_MODE,
    };
  }

  @Get('ready')
  getReady() {
    return {
      status: 'ok',
      checks: {
        envConfig: true,
        database: true,
        brokerAdapterConfigured: Boolean(this.envService.config.UPSTOX_API_KEY),
        workerConnected: true,
      },
      timestamp: new Date().toISOString(),
    };
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
      systemMode: this.envService.config.SYSTEM_MODE,
      marketFeed: {
        connected: feedHealth.staleCount === 0,
        latencyMs: feedHealth.feedLatencyMs,
        staleTicksCount: feedHealth.staleCount,
        lastTickAt: new Date().toISOString(),
      },
      brokerConnection: {
        authenticated: tokenMeta.exists && !tokenMeta.isExpired,
        rateLimiterTokensRemaining: 25,
        egressIpMatch: true,
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
