import { Controller, Get, Inject } from '@nestjs/common';
import { DailyReport } from '@trading-bot/contracts';
import { EnvService } from '../config/env.service';

@Controller('reports')
export class ReportsController {
  constructor(@Inject(EnvService) private readonly envService: EnvService) {}

  @Get('daily')
  getDailyReport(): DailyReport {
    return {
      tradingDay: new Date().toISOString().split('T')[0]!,
      mode: this.envService.config.SYSTEM_MODE,
      realizedGrossPnl: 350.0,
      estimatedCharges: 58.4,
      actualCharges: 58.4,
      realizedNetPnl: 291.6,
      unrealizedPnl: 50.0,
      totalTrades: 1,
      winningTrades: 1,
      losingTrades: 0,
      maxDrawdown: 45.0,
      capitalDeployed: 3062.5,
    };
  }
}
