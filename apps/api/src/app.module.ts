import { Module } from '@nestjs/common';
import { EnvService } from './config/env.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { BrokerController } from './broker/broker.controller';
import { RiskController } from './risk/risk.controller';
import { RiskService } from './risk/risk.service';
import { MarketsController } from './markets/markets.controller';
import { ProposalsController } from './proposals/proposals.controller';
import { OrdersController } from './orders/orders.controller';
import { ReportsController } from './reports/reports.controller';
import { EventsGateway } from './websocket/events.gateway';

@Module({
  imports: [],
  controllers: [
    HealthController,
    AuthController,
    BrokerController,
    RiskController,
    MarketsController,
    ProposalsController,
    OrdersController,
    ReportsController,
  ],
  providers: [EnvService, RiskService, EventsGateway],
  exports: [EnvService, RiskService],
})
export class AppModule {}
