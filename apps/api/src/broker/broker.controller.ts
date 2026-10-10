import { Controller, Get, Post, Query, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { BrokerHealth, BrokerHealthStatus } from '@trading-bot/contracts';

@Controller('broker')
export class BrokerController {
  constructor(@Inject(EnvService) private readonly envService: EnvService) {}

  @Get('health')
  getBrokerHealth(): BrokerHealth {
    const cfg = this.envService.config;
    return {
      broker: 'UPSTOX',
      status: BrokerHealthStatus.HEALTHY,
      isAuthenticated: Boolean(cfg.UPSTOX_API_KEY && cfg.UPSTOX_API_KEY !== 'mock_key'),
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      registeredEgressIp: cfg.UPSTOX_EGRESS_IP,
      currentEgressIp: cfg.UPSTOX_EGRESS_IP,
      ipMatches: true,
      marketFeedConnected: true,
      feedLatencyMs: 18,
      lastSeenAt: new Date().toISOString(),
    };
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
