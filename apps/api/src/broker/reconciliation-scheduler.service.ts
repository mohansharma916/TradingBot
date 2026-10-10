import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ReconciliationReport,
  ReconciliationScheduleStatus,
} from '@trading-bot/contracts';
import { BrokerReconciliationService } from './broker-reconciliation.service';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class ReconciliationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReconciliationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private intervalSeconds = 60;
  private lastRunAt: string | null = null;
  private totalRuns = 0;
  private lastDiscrepanciesFound = 0;
  private history: ReconciliationReport[] = [];

  constructor(
    @Inject(BrokerReconciliationService)
    private readonly reconciliationService: BrokerReconciliationService,
    @Inject(EventsGateway)
    private readonly gateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.startScheduler();
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  public startScheduler(intervalSeconds = 60): void {
    if (this.isRunning) return;
    this.intervalSeconds = intervalSeconds;
    this.isRunning = true;
    this.logger.log(
      `[ReconciliationScheduler] Starting automated audit background scheduler (interval: ${this.intervalSeconds}s)`,
    );

    // Initial run after short 5-second warmup
    setTimeout(() => {
      if (this.isRunning) {
        this.runAuditCycle();
      }
    }, 5000);

    this.timer = setInterval(() => {
      this.runAuditCycle();
    }, this.intervalSeconds * 1000);
  }

  public stopScheduler(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('[ReconciliationScheduler] Audit background scheduler stopped.');
  }

  public async runAuditCycle(): Promise<ReconciliationReport> {
    try {
      this.lastRunAt = new Date().toISOString();
      this.totalRuns++;

      const report = await this.reconciliationService.runReconciliation();
      this.lastDiscrepanciesFound = report.discrepancies.length;

      // Keep recent 20 runs
      this.history.unshift(report);
      if (this.history.length > 20) {
        this.history.pop();
      }

      this.gateway.broadcast('broker.reconciliation_completed', {
        status: report.status,
        discrepanciesCount: report.discrepancies.length,
        timestamp: this.lastRunAt,
      });

      return report;
    } catch (err: any) {
      this.logger.error(`[ReconciliationScheduler] Error during scheduled audit cycle: ${err.message}`);
      throw err;
    }
  }

  public getStatus(): ReconciliationScheduleStatus {
    return {
      schedulerActive: this.isRunning,
      intervalSeconds: this.intervalSeconds,
      lastRunAt: this.lastRunAt,
      totalRuns: this.totalRuns,
      lastDiscrepanciesFound: this.lastDiscrepanciesFound,
    };
  }

  public getHistory(): ReconciliationReport[] {
    return [...this.history];
  }
}
