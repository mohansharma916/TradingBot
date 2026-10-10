import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DailyBotCloneRequestSchema,
  DailyBotConfig,
  DailyBotConfigSchema,
  DailyBotPreflight,
  DailyBotSession,
  DailyBotSessionSchema,
  DailyBotSetup,
  DailyBotStartRequestSchema,
  DailyBotToday,
  StrategyStatus,
  TradeMode,
} from '@trading-bot/contracts';
import { NSE_HOLIDAYS_2026 } from '@trading-bot/domain';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EnvService } from '../config/env.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { StrategiesService } from '../strategies/strategies.service';
import { DailyBotExecutionService } from './daily-bot-execution.service';
import { DailyBotState, DailyBotStore } from './daily-bot.store';

export function dailyBotTradingDate(date = new Date()): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function hasOpenTrade(session: DailyBotSession): boolean {
  return session.trades.some((trade) => trade.status !== 'CLOSED');
}

function isActive(session: DailyBotSession): boolean {
  return ['RUNNING', 'PAUSED', 'STOPPING', 'ERROR'].includes(session.status) || hasOpenTrade(session) || session.pendingProposalId !== null;
}

function isTradingDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6 && !NSE_HOLIDAYS_2026[date];
}

function dayOutcomes(state: DailyBotState, tradingDate: string) {
  const sessions = state.sessions.filter((session) => session.config.tradingDate === tradingDate);
  const closedTrades = Array.from(new Map(sessions.flatMap((session) => session.trades).filter((trade) => trade.status === 'CLOSED').map((trade) => [trade.orderId, trade])).values());
  return {
    sessions,
    closedTrades,
    tradesExecuted: Math.max(closedTrades.length, ...sessions.map((session) => session.tradesExecuted), 0),
    realizedLoss: closedTrades.reduce((sum, trade) => sum + Math.max(0, -trade.realizedNetPnl), 0),
    processedSignalKeys: Array.from(new Set(sessions.flatMap((session) => session.processedSignalKeys))),
  };
}

function parseRequest<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ message: 'Invalid Daily Bot configuration', errors: result.error.flatten() });
  }
  return result.data;
}

@Injectable()
export class DailyBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyBotService.name);
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private volatileSessions = new Map<string, DailyBotSession>();

  constructor(
    @Inject(DailyBotStore) private readonly store: DailyBotStore,
    @Inject(DailyBotExecutionService) private readonly execution: DailyBotExecutionService,
    @Inject(StrategiesService) private readonly strategies: StrategiesService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(RiskReservationManager) private readonly reservations: RiskReservationManager,
  ) {
    const savedState = this.store.snapshot();
    this.restoreMissingStrategies(savedState);
    const restoredPaperSessions = this.execution.restoreDailyLedger(savedState.sessions);
    this.recoverSessions(restoredPaperSessions ?? new Set<string>());
  }

  private restoreMissingStrategies(state: DailyBotState): void {
    const currentIds = new Set(this.strategies.getAllStrategies().map((strategy) => strategy.id));
    const snapshots = [...state.setups].sort((a, b) => b.strategySnapshot.version - a.strategySnapshot.version || b.createdAt.localeCompare(a.createdAt));
    for (const setup of snapshots) {
      if (currentIds.has(setup.strategySnapshot.id)) continue;
      this.strategies.createStrategy(structuredClone(setup.strategySnapshot));
      currentIds.add(setup.strategySnapshot.id);
    }
  }

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.logger.error(error instanceof Error ? error.message : String(error)));
    }, 5_000);
    this.timer.unref?.();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private recoverSessions(restoredPaperSessions: Set<string>): void {
    const state = this.store.snapshot();
    let changed = false;
    for (const session of state.sessions) {
      if (!isActive(session)) continue;
      const unresolvedEntry = session.pendingProposalId !== null;
      const restoredPosition = restoredPaperSessions.has(session.id) && !unresolvedEntry;
      session.status = (hasOpenTrade(session) && !restoredPosition) || unresolvedEntry ? 'ERROR' : 'PAUSED';
      session.lastMessage = unresolvedEntry
        ? 'API restarted during an entry intent. Its broker result was not durably confirmed; new entries are blocked until the order and account state are reviewed.'
        : restoredPosition
        ? 'API restarted. Confirmed paper fills, positions and risk reservations were restored from durable records. Protection continues; new entries are paused until an explicit resume.'
        : hasOpenTrade(session)
        ? 'API restarted with an unresolved paper position. New entries are blocked until broker state is reconciled; no position has been assumed closed.'
        : 'API restarted. New entries are paused; review preflight and explicitly resume.';
      session.events.push({ timestamp: new Date().toISOString(), type: 'RECOVERY_REQUIRED', message: session.lastMessage });
      changed = true;
    }
    if (changed) this.store.commit(state);
  }

  public getSetups(): DailyBotSetup[] {
    return this.store.snapshot().setups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public getSession(id: string): DailyBotSession {
    const session = this.volatileSessions.get(id) || this.store.snapshot().sessions.find((candidate) => candidate.id === id);
    if (!session) throw new NotFoundException(`Daily Bot session '${id}' was not found.`);
    return structuredClone(session);
  }

  public getToday(): DailyBotToday {
    const state = this.store.snapshot();
    const tradingDate = dailyBotTradingDate();
    const setups = state.setups.sort((a, b) => b.config.tradingDate.localeCompare(a.config.tradingDate) || b.createdAt.localeCompare(a.createdAt));
    const sessions = state.sessions.map((session) => this.volatileSessions.get(session.id) || session)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      tradingDate,
      setups,
      todaySetup: setups.find((setup) => setup.config.tradingDate === tradingDate) || null,
      previousSetup: setups.find((setup) => setup.config.tradingDate < tradingDate && isTradingDate(setup.config.tradingDate)) || null,
      activeSession: sessions.find(isActive) || null,
      session: sessions.find((session) => session.config.tradingDate === tradingDate) || null,
      strategies: structuredClone(this.strategies.getAllStrategies()),
      availableFunds: Math.max(0, this.reservations.getAvailableCash()),
      supportedModes: [TradeMode.PAPER],
    };
  }

  private getSetup(state: DailyBotState, id: string): DailyBotSetup {
    const setup = state.setups.find((candidate) => candidate.id === id);
    if (!setup) throw new NotFoundException(`Daily Bot setup '${id}' was not found.`);
    return setup;
  }

  private validateAccountCaps(config: DailyBotConfig): void {
    const caps = this.env.config;
    if (config.dailyCapitalBudget > caps.MAX_ACCOUNT_CAPITAL_INR || config.maxCapitalPerTrade > caps.MAX_ACCOUNT_CAPITAL_INR) {
      throw new BadRequestException(`Capital allocation exceeds the configured account cap of ₹${caps.MAX_ACCOUNT_CAPITAL_INR}.`);
    }
    if (config.perTradeMaxLossAllIn > caps.MAX_ALL_IN_TRADE_RISK_INR || config.dailyMaxLossAllIn > caps.MAX_DAILY_DRAWDOWN_INR) {
      throw new BadRequestException('The setup exceeds the configured account risk limits.');
    }
  }

  public createSetup(input: unknown): Promise<DailyBotSetup> {
    return this.serialize(() => {
      this.store.assertWritable();
      const config = parseRequest(DailyBotConfigSchema, input);
      this.validateAccountCaps(config);
      const setup: DailyBotSetup = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        clonedFromId: null,
        config,
        strategySnapshot: structuredClone(this.strategies.getStrategy(config.strategyId)),
      };
      const state = this.store.snapshot();
      state.setups.push(setup);
      this.store.commit(state);
      return structuredClone(setup);
    });
  }

  public cloneSetup(id: string, input: unknown): Promise<DailyBotSetup> {
    return this.serialize(() => {
      this.store.assertWritable();
      const { tradingDate } = parseRequest(DailyBotCloneRequestSchema, input);
      const state = this.store.snapshot();
      const source = this.getSetup(state, id);
      const setup: DailyBotSetup = {
        ...structuredClone(source),
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        clonedFromId: source.id,
        config: { ...source.config, tradingDate },
      };
      this.validateAccountCaps(setup.config);
      state.setups.push(setup);
      this.store.commit(state);
      return structuredClone(setup);
    });
  }

  private async evaluatePreflight(setup: DailyBotSetup, exceptSessionId?: string): Promise<DailyBotPreflight> {
    const existingSession = exceptSessionId ? this.getSession(exceptSessionId) : undefined;
    const preflight = await this.execution.preflight(setup.config, setup.strategySnapshot, existingSession);
    const state = this.store.snapshot();
    const active = state.sessions.find((session) => session.id !== exceptSessionId && isActive(session));
    const outcomes = dayOutcomes(state, setup.config.tradingDate);
    const currentStrategy = this.strategies.getAllStrategies().find((strategy) => strategy.id === setup.config.strategyId);
    const account = this.env.config;
    preflight.checks.push({
      id: 'daily-date', label: 'Trading date in IST', passed: setup.config.tradingDate === dailyBotTradingDate(),
      message: setup.config.tradingDate === dailyBotTradingDate() ? 'Setup is dated for today in Asia/Kolkata.' : 'Clone this setup for today before starting it.',
    }, {
      id: 'single-session', label: 'Single account session', passed: !active,
      message: active ? `Session ${active.id} requires review or stop before another session can start.` : 'No other active or unresolved session.',
    }, {
      id: 'account-caps', label: 'Configured account risk caps',
      passed: setup.config.dailyCapitalBudget <= account.MAX_ACCOUNT_CAPITAL_INR && setup.config.perTradeMaxLossAllIn <= account.MAX_ALL_IN_TRADE_RISK_INR && setup.config.dailyMaxLossAllIn <= account.MAX_DAILY_DRAWDOWN_INR,
      message: 'Setup must fit the account capital, per-trade loss and daily loss caps.',
    }, {
      id: 'persisted-day-budget', label: 'Trading-day outcomes',
      passed: outcomes.tradesExecuted < setup.config.maximumTradesPerDay && outcomes.realizedLoss < setup.config.dailyMaxLossAllIn,
      message: `${outcomes.tradesExecuted} trades and ₹${outcomes.realizedLoss.toFixed(2)} realized losses are already recorded for this date. Earlier sessions count toward today's limits.`,
    }, {
      id: 'strategy-authorization', label: 'Current strategy authorization',
      passed: Boolean(currentStrategy && ![StrategyStatus.RETIRED, StrategyStatus.PAUSED, StrategyStatus.DRAFT].includes(currentStrategy.status)),
      message: currentStrategy && ![StrategyStatus.RETIRED, StrategyStatus.PAUSED, StrategyStatus.DRAFT].includes(currentStrategy.status)
        ? 'The selected strategy remains authorized. Its saved rule version is preserved.'
        : 'The selected strategy is unavailable, retired, paused or draft. Select an active tested strategy before starting new entries.',
    });
    preflight.passed = preflight.checks.every((check) => check.passed);
    return preflight;
  }

  public preflight(id: string): Promise<DailyBotPreflight> {
    return this.serialize(() => this.evaluatePreflight(this.getSetup(this.store.snapshot(), id)));
  }

  public start(id: string, input: unknown): Promise<DailyBotSession> {
    return this.serialize(async () => {
      this.store.assertWritable();
      const request = parseRequest(DailyBotStartRequestSchema, input);
      if (!request.operatorConsent) throw new BadRequestException('Explicit operator consent is required to start the Daily Bot.');
      const state = this.store.snapshot();
      const setup = this.getSetup(state, id);
      if (setup.config.tradingMode !== TradeMode.PAPER) {
        throw new BadRequestException('Daily Bot live modes are disabled until broker-confirmed delayed trailing protection is supported. Choose PAPER.');
      }
      if (state.sessions.some(isActive)) throw new ConflictException('An active or unresolved Daily Bot session already exists. Review that session before starting another.');
      const preflight = await this.evaluatePreflight(setup);
      if (!preflight.passed) throw new BadRequestException({ message: 'Daily Bot preflight failed', preflight });

      // Repeated sessions may not reset trading-day losses, trade counts or signal deduplication.
      const outcomes = dayOutcomes(state, setup.config.tradingDate);
      const now = new Date().toISOString();
      const session = DailyBotSessionSchema.parse({
        id: randomUUID(), setupId: setup.id, config: structuredClone(setup.config), strategySnapshot: structuredClone(setup.strategySnapshot),
        status: 'RUNNING', startedAt: now, stoppedAt: null, lastHeartbeatAt: null,
        lastMessage: 'Daily Bot started. Server scans and protection continue while the app is closed.',
        tradesExecuted: outcomes.tradesExecuted,
        trades: outcomes.closedTrades, pendingProposalId: null, pendingProposal: null,
        processedSignalKeys: outcomes.processedSignalKeys,
        lastScanBar: null,
        events: [{ timestamp: now, type: 'STARTED', message: 'Operator authorized paper execution after successful preflight.' }],
      });
      if (outcomes.sessions.length) session.events.push({ timestamp: now, type: 'DAY_BUDGET_RESTORED', message: 'Earlier trades, losses and consumed signals for this date were retained.' });
      state.sessions.push(session);
      this.store.commit(state);
      return structuredClone(session);
    });
  }

  private saveSession(session: DailyBotSession): void {
    const state = this.store.snapshot();
    const index = state.sessions.findIndex((candidate) => candidate.id === session.id);
    if (index < 0) throw new NotFoundException('Daily Bot session was not found.');
    state.sessions[index] = session;
    try {
      this.store.commit(state);
      this.volatileSessions.delete(session.id);
    } catch (error) {
      session.status = 'ERROR';
      session.pendingProposalId = null;
      session.pendingProposal = null;
      session.lastMessage = 'Persistence failed. New entries are disabled; review broker positions and repair storage before resuming.';
      this.volatileSessions.set(session.id, structuredClone(session));
      throw error;
    }
  }

  public pause(id: string): Promise<DailyBotSession> {
    return this.serialize(() => {
      this.store.assertWritable();
      const session = this.getSession(id);
      if (session.status !== 'RUNNING' && session.status !== 'PAUSED') throw new ConflictException('Only a running session can be paused.');
      session.status = 'PAUSED';
      session.pendingProposalId = null;
      session.pendingProposal = null;
      session.lastMessage = 'New entries paused. Existing position protection continues on the server.';
      session.events.push({ timestamp: new Date().toISOString(), type: 'PAUSED', message: session.lastMessage });
      this.saveSession(session);
      return session;
    });
  }

  public resume(id: string): Promise<DailyBotSession> {
    return this.serialize(async () => {
      this.store.assertWritable();
      const session = this.getSession(id);
      if (session.status !== 'PAUSED') throw new ConflictException('Only a paused session can resume. Reconcile any error before opening new entries.');
      const setup = this.getSetup(this.store.snapshot(), session.setupId);
      const preflight = await this.evaluatePreflight(setup, session.id);
      if (!preflight.passed) throw new BadRequestException({ message: 'Resume preflight failed', preflight });
      session.status = 'RUNNING';
      session.lastMessage = 'New entries resumed after a fresh preflight.';
      session.events.push({ timestamp: new Date().toISOString(), type: 'RESUMED', message: session.lastMessage });
      this.saveSession(session);
      return session;
    });
  }

  public stop(id: string, emergency = false): Promise<DailyBotSession> {
    return this.serialize(async () => {
      const session = this.getSession(id);
      session.status = 'STOPPING';
      session.pendingProposalId = null;
      session.pendingProposal = null;
      // A durable intent prevents a restart from silently returning to entries.
      if (!emergency) this.saveSession(session);
      try {
        await this.execution.stop(session, emergency, (checkpoint) => this.saveSession(checkpoint));
      } catch (error) {
        session.status = 'ERROR';
        session.lastMessage = error instanceof Error ? error.message : 'Stop failed; review existing positions.';
        session.events.push({ timestamp: new Date().toISOString(), type: 'STOP_ERROR', message: session.lastMessage });
      }
      this.saveSession(session);
      return structuredClone(session);
    });
  }

  public approveEntry(id: string): Promise<DailyBotSession> {
    return this.serialize(async () => {
      this.store.assertWritable();
      const session = this.getSession(id);
      if (session.status !== 'RUNNING') throw new ConflictException('Entry approval requires a running session.');
      await this.execution.approveEntry(session, (checkpoint) => this.saveSession(checkpoint));
      this.saveSession(session);
      return structuredClone(session);
    });
  }

  public async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.serialize(async () => {
        let storageReady = true;
        try { this.store.assertWritable(); } catch { storageReady = false; }
        const sessions = this.store.snapshot().sessions.map((session) => structuredClone(this.volatileSessions.get(session.id) || session));
        let persistenceError: unknown;
        for (const session of sessions) {
          if (!storageReady) {
            session.status = 'ERROR';
            if (!hasOpenTrade(session)) continue;
          }
          if (session.status !== 'RUNNING' && !hasOpenTrade(session)) continue;
          try {
            await this.execution.tick(session, (checkpoint) => this.saveSession(checkpoint));
          } catch (error) {
            session.status = 'ERROR';
            session.lastMessage = error instanceof Error ? error.message : 'Bot scan failed. New entries disabled.';
            session.events.push({ timestamp: new Date().toISOString(), type: 'EXECUTION_ERROR', message: session.lastMessage });
          }
          session.lastHeartbeatAt = new Date().toISOString();
          try { this.saveSession(session); } catch (error) { persistenceError = error; }
        }
        if (persistenceError) throw persistenceError;
      });
    } finally {
      this.ticking = false;
    }
  }
}
