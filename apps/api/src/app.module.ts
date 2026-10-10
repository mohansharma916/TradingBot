import { Module } from '@nestjs/common';
import { EnvService } from './config/env.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { BrokerController } from './broker/broker.controller';
import { RiskController } from './risk/risk.controller';
import { RiskService } from './risk/risk.service';
import { MarketsController } from './markets/markets.controller';
import { InstrumentsController } from './instruments/instruments.controller';
import { ProposalsController } from './proposals/proposals.controller';
import { OrdersController } from './orders/orders.controller';
import { ReportsController } from './reports/reports.controller';
import { EventsGateway } from './websocket/events.gateway';
import { ProtobufDecoderService } from './market-data/protobuf-decoder.service';
import { InstrumentCatalogService } from './instruments/instrument-catalog.service';
import { PaperBrokerAdapter } from './broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from './broker/upstox-broker.adapter';
import { UpstoxMarketFeedService } from './market-data/upstox-market-feed.service';

@Module({
  imports: [],
  controllers: [
    HealthController,
    AuthController,
    BrokerController,
    RiskController,
    MarketsController,
    InstrumentsController,
    ProposalsController,
    OrdersController,
    ReportsController,
  ],
  providers: [
    EnvService,
    RiskService,
    EventsGateway,
    ProtobufDecoderService,
    InstrumentCatalogService,
    PaperBrokerAdapter,
    UpstoxBrokerAdapter,
    UpstoxMarketFeedService,
  ],
  exports: [
    EnvService,
    RiskService,
    EventsGateway,
    ProtobufDecoderService,
    InstrumentCatalogService,
    PaperBrokerAdapter,
    UpstoxBrokerAdapter,
    UpstoxMarketFeedService,
  ],
})
export class AppModule {}
