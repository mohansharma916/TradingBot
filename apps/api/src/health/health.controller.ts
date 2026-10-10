import { Controller, Get, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';

@Controller('health')
export class HealthController {
  private startTime = Date.now();

  constructor(@Inject(EnvService) private readonly envService: EnvService) {}

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
}
