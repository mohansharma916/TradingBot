import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PaperLaneSnapshot, TradeMode } from '@trading-bot/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { AgentToolsService } from '../agents/agent-tools.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { EnvService } from '../config/env.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { DataJournalService } from '../journal/data-journal.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { StrategiesService } from '../strategies/strategies.service';
import { EventsGateway } from '../websocket/events.gateway';
import { DailyBotExecutionService } from './daily-bot-execution.service';
import { DailyBotService, dailyBotTradingDate } from './daily-bot.service';
import { DailyBotStore } from './daily-bot.store';

export interface PaperLane {
  strategyId: string;
  directory: string;
  dailyBot: DailyBotService;
  store: DailyBotStore;
  reservations: RiskReservationManager;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Isolated virtual accounts, one per strategy, so several strategies can paper trade the same day.
 * Each lane owns its paper broker, risk ledger, proposals and Daily Bot store and runs the unchanged
 * Daily Bot execution path. Lanes are Testing-only: no broker router or live ledger is ever wired in.
 * Market data, instruments and read-only signal analysis are shared.
 */
@Injectable()
export class PaperLanesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperLanesService.name);
  public readonly directory: string;
  private readonly lanes = new Map<string, PaperLane>();
  private initialized = false;

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(StrategiesService) private readonly strategies: StrategiesService,
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
    @Inject(AgentToolsService) private readonly tools: AgentToolsService,
    @Inject(UpstoxMarketFeedService) private readonly feed: UpstoxMarketFeedService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(DataJournalService) private readonly journal?: DataJournalService,
    @Optional() @Inject('PAPER_LANES_DIRECTORY') directory?: string,
  ) {
    this.directory = path.resolve(directory || path.join(env.config.STATE_DIRECTORY ?? '.data', 'paper-lanes'));
  }

  /** Reload every existing lane so open virtual positions keep their protection after a restart. */
  public onModuleInit(): void {
    this.initialized = true;
    let entries: string[] = [];
    try { entries = fs.readdirSync(this.directory); } catch { /* No lanes yet. */ }
    for (const strategyId of entries.filter((entry) => UUID.test(entry))) {
      try { this.getLane(strategyId); } catch (error) {
        this.logger.error(`[PaperLanes] Lane ${strategyId} could not be restored: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  public onModuleDestroy(): void {
    for (const lane of this.lanes.values()) lane.dailyBot.onModuleDestroy();
    this.lanes.clear();
  }

  public getLane(strategyId: string): PaperLane {
    const existing = this.lanes.get(strategyId);
    if (existing) return existing;
    if (!UUID.test(strategyId)) throw new Error('Paper lanes are keyed by strategy id.');
    const directory = path.join(this.directory, strategyId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const laneEnv = { config: { ...this.env.config, STATE_DIRECTORY: directory, LIVE_EXECUTION_ENABLED: false } } as EnvService;
    const store = new DailyBotStore(path.join(directory, 'daily-bot.json'), laneEnv, this.journal);
    const paperBroker = new PaperBrokerAdapter(this.catalog, this.feed, this.gateway, laneEnv, path.join(directory, 'paper-broker.json'));
    const reservations = new RiskReservationManager(laneEnv, this.gateway);
    const proposals = new ProposalsService(this.gateway, laneEnv);
    const execution = new DailyBotExecutionService(paperBroker, reservations, this.coordinator, this.tools, this.feed, this.catalog, laneEnv, proposals, this.gateway);
    const dailyBot = new DailyBotService(store, execution, this.strategies, laneEnv, reservations);
    if (this.initialized) dailyBot.onModuleInit();
    const lane = { strategyId, directory, dailyBot, store, reservations };
    this.lanes.set(strategyId, lane);
    return lane;
  }

  public getLanes(): PaperLane[] {
    return [...this.lanes.values()];
  }

  public snapshot(tradingDate = dailyBotTradingDate()): PaperLaneSnapshot[] {
    return this.getLanes().map((lane) => {
      const today = lane.dailyBot.getToday();
      const session = today.activeSession ?? today.session;
      const current = session?.config.tradingDate === tradingDate ? session : today.activeSession;
      const strategy = this.strategies.getAllStrategies().find((candidate) => candidate.id === lane.strategyId);
      return {
        strategyId: lane.strategyId,
        strategyName: current?.strategySnapshot.name ?? strategy?.name ?? 'Removed strategy',
        sessionId: current?.id ?? null,
        status: current?.status ?? null,
        tradingDate: current?.config.tradingDate ?? null,
        tradesExecuted: current?.tradesExecuted ?? 0,
        realizedNetPnl: Math.round((current?.trades.reduce((sum, trade) => sum + (trade.status === 'CLOSED' ? trade.realizedNetPnl : 0), 0) ?? 0) * 100) / 100,
        openPositions: current?.trades.filter((trade) => trade.status !== 'CLOSED').map((trade) => trade.symbol) ?? [],
        availableFunds: Math.max(0, lane.reservations.getAvailableCash()),
        lastMessage: current?.lastMessage ?? null,
        lastHeartbeatAt: current?.lastHeartbeatAt ?? null,
        tradingMode: TradeMode.PAPER as const,
      };
    }).sort((a, b) => a.strategyName.localeCompare(b.strategyName));
  }

  /** Stops new entries in every lane; emergency also requests exits for open virtual positions. */
  public async stopAll(emergency = false): Promise<void> {
    for (const lane of this.lanes.values()) {
      const active = lane.dailyBot.getToday().activeSession;
      if (active) await lane.dailyBot.stop(active.id, emergency);
    }
  }

  /** Pauses new entries in all running lanes (open positions stay protected). */
  public async pauseAll(): Promise<number> {
    let paused = 0;
    for (const lane of this.lanes.values()) {
      const active = lane.dailyBot.getToday().activeSession;
      if (active?.status === 'RUNNING') { await lane.dailyBot.pause(active.id); paused++; }
    }
    return paused;
  }
}
