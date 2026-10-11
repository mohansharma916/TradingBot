import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Inject,
  HttpCode,
  HttpStatus,
  Optional,
  Req,
  Res,
} from '@nestjs/common';
import { EnvService } from '../config/env.service';
import {
  BrokerHealth,
  UpstoxSessionStatus,
  ReconciliationReport,
  ReconciliationScheduleStatus,
} from '@trading-bot/contracts';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter } from './upstox-broker.adapter';
import { UpstoxOAuthService } from './upstox-oauth.service';
import { BrokerReconciliationService } from './broker-reconciliation.service';
import { ReconciliationSchedulerService } from './reconciliation-scheduler.service';
import { BrokerRouterService } from './broker-router.service';

@Controller('broker')
export class BrokerController {
  constructor(
    @Inject(EnvService) _envService: EnvService,
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) _upstoxBroker: UpstoxBrokerAdapter,
    @Inject(UpstoxOAuthService) private readonly oauthService: UpstoxOAuthService,
    @Inject(BrokerReconciliationService) private readonly reconciliationService: BrokerReconciliationService,
    @Inject(ReconciliationSchedulerService) private readonly reconciliationScheduler: ReconciliationSchedulerService,
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
  ) {}

  private getActiveAdapter() {
    return this.router?.getBroker() || this.paperBroker;
  }

  @Get('health')
  async getBrokerHealth(): Promise<BrokerHealth> {
    return this.getActiveAdapter().getConnectionHealth();
  }

  @Get('funds')
  async getFunds() {
    return this.getActiveAdapter().getFunds();
  }

  // --- Upstox OAuth 2.0 Endpoints ---

  @Get('upstox/session')
  getUpstoxSession(): UpstoxSessionStatus {
    return this.oauthService.getSessionStatus();
  }

  @Post('upstox/connect')
  @HttpCode(HttpStatus.OK)
  connectUpstox() {
    return this.oauthService.generateAuthorizationUrl();
  }

  @Post('upstox/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallbackPost(
    @Body('code') code: string,
    @Body('state') state: string,
  ) {
    return this.oauthService.exchangeAuthorizationCode(code, state);
  }

  @Get('upstox/callback')
  async handleCallbackGet(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const isBrowser = Boolean(req?.headers?.accept?.includes('text/html'));
    if (!code || !state) {
      if (isBrowser) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html><body style="font-family:sans-serif;background:#0B0E14;color:#EF4444;text-align:center;padding:50px;">
            <h2>OAuth Connection Error</h2>
            <p>Missing code or state parameter from Upstox.</p>
            <p><a href="http://localhost:8081/health" style="color:#06B6D4">Return to Workstation</a></p>
          </body></html>
        `);
      }
      return res.status(400).json({
        success: false,
        message: 'Missing code or state in OAuth callback query parameters.',
      });
    }

    try {
      const result = await this.oauthService.exchangeAuthorizationCode(code, state);
      if (isBrowser) {
        return res.status(200).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Upstox Connected</title>
            <meta http-equiv="refresh" content="2;url=http://localhost:8081/health" />
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0E14; color: #10B981; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #151922; border: 1px solid #232936; padding: 36px; border-radius: 12px; text-align: center; max-width: 440px; box-shadow: 0 8px 30px rgba(0,0,0,0.6); }
              h2 { margin: 0 0 12px; font-size: 22px; }
              p { color: #94A3B8; font-size: 14px; line-height: 1.5; margin: 8px 0; }
              .btn { display: inline-block; margin-top: 16px; background: #06B6D4; color: #082F49; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>✓ Upstox Broker Connected!</h2>
              <p>Your session token was encrypted and stored successfully.</p>
              <p>Redirecting to your Trading Workstation in 2 seconds...</p>
              <a class="btn" href="http://localhost:8081/health">Return to Workstation</a>
            </div>
          </body>
          </html>
        `);
      }
      return res.json(result);
    } catch (err: any) {
      if (isBrowser) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html><body style="font-family:sans-serif;background:#0B0E14;color:#EF4444;text-align:center;padding:50px;">
            <h2>Upstox Connection Failed</h2>
            <p>${err?.message || 'Token exchange failed'}</p>
            <p><a href="http://localhost:8081/health" style="color:#06B6D4">Return to Workstation</a></p>
          </body></html>
        `);
      }
      return res.status(400).json({ success: false, message: err?.message || 'Token exchange failed' });
    }
  }

  @Post('upstox/disconnect')
  @HttpCode(HttpStatus.OK)
  disconnectUpstox() {
    return this.oauthService.disconnect();
  }

  // --- Broker Reconciliation Endpoints ---

  @Get('reconciliation-status')
  getReconciliationStatus(): ReconciliationReport {
    return this.reconciliationService.getLatestReport();
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async triggerReconciliation(): Promise<ReconciliationReport> {
    return this.reconciliationService.runReconciliation();
  }

  @Get('reconciliation/schedule')
  getReconciliationSchedule(): ReconciliationScheduleStatus {
    return this.reconciliationScheduler.getStatus();
  }

  @Get('reconciliation/history')
  getReconciliationHistory(): ReconciliationReport[] {
    return this.reconciliationScheduler.getHistory();
  }

  @Post('reconciliation/schedule/start')
  @HttpCode(HttpStatus.OK)
  startReconciliationSchedule(@Body('intervalSeconds') interval = 60) {
    this.reconciliationScheduler.startScheduler(interval);
    return this.reconciliationScheduler.getStatus();
  }

  @Post('reconciliation/schedule/stop')
  @HttpCode(HttpStatus.OK)
  stopReconciliationSchedule() {
    this.reconciliationScheduler.stopScheduler();
    return this.reconciliationScheduler.getStatus();
  }
}
