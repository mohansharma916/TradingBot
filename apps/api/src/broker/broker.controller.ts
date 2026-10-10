import { Controller, Get, Post, Query, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { BrokerHealth } from '@trading-bot/contracts';
import { PaperBrokerAdapter } from './paper-broker.adapter';
import { UpstoxBrokerAdapter } from './upstox-broker.adapter';

@Controller('broker')
export class BrokerController {
  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(PaperBrokerAdapter) private readonly paperBroker: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker: UpstoxBrokerAdapter,
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

  @Post('upstox/connect')
  connectUpstox() {
    const state = Math.random().toString(36).substring(2);
    const redirectUrl = `${this.envService.config.UPSTOX_BASE_URL}/login/authorization/dialog?response_type=code&client_id=${this.envService.config.UPSTOX_API_KEY}&redirect_uri=${encodeURIComponent(this.envService.config.UPSTOX_REDIRECT_URI)}&state=${state}`;

    return {
      redirectUrl,
      state,
      registeredEgressIp: this.envService.config.UPSTOX_EGRESS_IP,
    };
  }

  @Get('upstox/callback')
  handleCallback(@Query('code') code: string, @Query('state') state: string) {
    return {
      success: true,
      message: 'Broker authorization code received. Ready to exchange for access token.',
      codeReceived: Boolean(code),
      state,
    };
  }
}
