import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { BrokerHealth, UpstoxSessionStatus, ReconciliationReport } from '@trading-bot/contracts';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter } from './upstox-broker.adapter';
import { UpstoxOAuthService } from './upstox-oauth.service';
import { BrokerReconciliationService } from './broker-reconciliation.service';

@Controller('broker')
export class BrokerController {
  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker: UpstoxBrokerAdapter,
    @Inject(UpstoxOAuthService) private readonly oauthService: UpstoxOAuthService,
    @Inject(BrokerReconciliationService) private readonly reconciliationService: BrokerReconciliationService,
  ) {}

  private getActiveAdapter() {
    return this.envService.config.SYSTEM_MODE === 'PAPER'
      ? this.paperBroker
      : this.upstoxBroker;
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
  ) {
    if (!code || !state) {
      return {
        success: false,
        message: 'Missing code or state in OAuth callback query parameters.',
      };
    }
    return this.oauthService.exchangeAuthorizationCode(code, state);
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
}
