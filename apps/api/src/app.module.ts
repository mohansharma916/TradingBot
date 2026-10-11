import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OwnerAuthGuard } from './auth/owner-auth.guard';
import { OwnerAuthService } from './auth/owner-auth.service';
import { TradingModeService } from './trading/trading-mode.service';
import { TradingController } from './trading/trading.controller';
import { RuntimeLeaseService } from './trading/runtime-lease.service';
import { BrokerRouterService } from './broker/broker-router.service';
import { LiveExecutionLedgerService } from './broker/live-execution-ledger.service';
import { LiveExitMonitorService } from './orders/live-exit-monitor.service';
import { EnvService } from './config/env.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { BrokerController } from './broker/broker.controller';
import { RiskController } from './risk/risk.controller';
import { RiskService } from './risk/risk.service';
import { MarketsController } from './markets/markets.controller';
import { InstrumentsController } from './instruments/instruments.controller';
import { ProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';
import { OrdersController } from './orders/orders.controller';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { StrategiesController } from './strategies/strategies.controller';
import { StrategiesService } from './strategies/strategies.service';
import { PriceActionMomentumService } from './strategies/price-action-momentum.service';
import { AgentsController } from './agents/agents.controller';
import { AgentToolsService } from './agents/agent-tools.service';
import { MarketScannerAgent } from './agents/market-scanner.agent';
import { StrategyAnalystAgent } from './agents/strategy-analyst.agent';
import { AgentCoordinatorService } from './agents/agent-coordinator.service';
import { EventsGateway } from './websocket/events.gateway';
import { ProtobufDecoderService } from './market-data/protobuf-decoder.service';
import { InstrumentCatalogService } from './instruments/instrument-catalog.service';
import { PaperBrokerAdapter } from './broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from './broker/upstox-broker.adapter';
import { UpstoxMarketFeedService } from './market-data/upstox-market-feed.service';
import { RiskReservationManager } from './risk/risk-reservation.manager';
import { OrdersService } from './orders/orders.service';
import { TokenStorageService } from './broker/token-storage.service';
import { UpstoxOAuthService } from './broker/upstox-oauth.service';
import { BrokerReconciliationService } from './broker/broker-reconciliation.service';
import { ReconciliationSchedulerService } from './broker/reconciliation-scheduler.service';
import { SupervisedExecutionService } from './orders/supervised-execution.service';
import { GoLiveChecklistService } from './orders/go-live-checklist.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { AutonomousController } from './orders/autonomous.controller';
import { AutonomousExecutionService } from './orders/autonomous-execution.service';
import { DailyBotController } from './daily-bot/daily-bot.controller';
import { DailyBotService } from './daily-bot/daily-bot.service';
import { DailyBotStore } from './daily-bot/daily-bot.store';
import { DailyBotExecutionService } from './daily-bot/daily-bot-execution.service';

@Module({
  imports: [],
  controllers: [
    TradingController,
    HealthController,
    AuthController,
    BrokerController,
    RiskController,
    MarketsController,
    InstrumentsController,
    ProposalsController,
    StrategiesController,
    AgentsController,
    OrdersController,
    ReportsController,
    NotificationsController,
    AutonomousController,
    DailyBotController,
  ],
  providers: [
    EnvService,
    RuntimeLeaseService,
    OwnerAuthService,
    { provide: APP_GUARD, useClass: OwnerAuthGuard },
    TradingModeService,
    BrokerRouterService,
    LiveExecutionLedgerService,
    LiveExitMonitorService,
    RiskService,
    EventsGateway,
    ProtobufDecoderService,
    InstrumentCatalogService,
    PaperBrokerAdapter,
    UpstoxBrokerAdapter,
    UpstoxMarketFeedService,
    ProposalsService,
    AgentToolsService,
    MarketScannerAgent,
    StrategyAnalystAgent,
    AgentCoordinatorService,
    StrategiesService,
    PriceActionMomentumService,
    RiskReservationManager,
    OrdersService,
    TokenStorageService,
    UpstoxOAuthService,
    BrokerReconciliationService,
    ReconciliationSchedulerService,
    SupervisedExecutionService,
    GoLiveChecklistService,
    NotificationsService,
    ReportsService,
    AutonomousExecutionService,
    DailyBotStore,
    DailyBotService,
    DailyBotExecutionService,
  ],
  exports: [
    EnvService,
    TradingModeService,
    BrokerRouterService,
    LiveExecutionLedgerService,
    RiskService,
    EventsGateway,
    ProtobufDecoderService,
    InstrumentCatalogService,
    PaperBrokerAdapter,
    UpstoxBrokerAdapter,
    UpstoxMarketFeedService,
    ProposalsService,
    AgentToolsService,
    MarketScannerAgent,
    StrategyAnalystAgent,
    AgentCoordinatorService,
    StrategiesService,
    RiskReservationManager,
    OrdersService,
    TokenStorageService,
    UpstoxOAuthService,
    BrokerReconciliationService,
    ReconciliationSchedulerService,
    SupervisedExecutionService,
    GoLiveChecklistService,
    NotificationsService,
    ReportsService,
    AutonomousExecutionService,
    DailyBotStore,
    DailyBotService,
    DailyBotExecutionService,
  ],
})
export class AppModule {}

