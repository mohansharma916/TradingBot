import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import {
  AlertSeverity,
  AutopilotLaneRun,
  AutopilotRun,
  AutopilotRunSchema,
  AutopilotSchedule,
  AutopilotScheduleSchema,
  AutopilotStatus,
  AutopilotUpdateRequestSchema,
  DailyBotConfigSchema,
  DailyBotSession,
  StrategyConfig,
  StrategyScorecard,
  StrategyStatus,
  TradeMode,
} from '@trading-bot/contracts';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { EnvService } from '../config/env.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StrategiesService } from '../strategies/strategies.service';
import { TradingModeService } from '../trading/trading-mode.service';
import { DailyBotService, dailyBotTradingDate, isTradingDate } from './daily-bot.service';
import { DailyBotStore } from './daily-bot.store';
import { PaperLanesService } from './paper-lanes.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';

const AutopilotStateSchema = z.object({
  version: z.literal(1),
  schedule: AutopilotScheduleSchema.nullable(),
  rotationIndex: z.number().int().nonnegative(),
  runs: z.array(AutopilotRunSchema),
});
type AutopilotState = z.infer<typeof AutopilotStateSchema>;

const RETRY_INTERVAL_MS = 60_000;
const MAX_RUN_HISTORY = 90;
const UNAUTHORIZED = [StrategyStatus.DRAFT, StrategyStatus.PAUSED, StrategyStatus.RETIRED, StrategyStatus.ARCHIVED];

const isAuthorized = (strategy: StrategyConfig) => !UNAUTHORIZED.includes(strategy.status);
const round = (value: number) => Math.round(value * 100) / 100;

function istTime(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(11, 16);
}

/** Names the failed preflight checks instead of the generic exception text. */
function describeFailure(error: unknown): string {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.() as { preflight?: { checks?: { passed: boolean; label: string; message: string }[] } } | undefined;
  const failed = response?.preflight?.checks?.filter((check) => !check.passed).map((check) => `${check.label}: ${check.message}`);
  if (failed?.length) return failed.join(' | ');
  return error instanceof Error ? error.message : String(error);
}

/**
 * Per-strategy outcomes from recorded Daily Bot sessions. Restarted sessions carry the day's earlier
 * closed trades, so each order is counted once and attributed to the session that first recorded it.
 */
export function buildStrategyScorecard(sessions: DailyBotSession[]): StrategyScorecard[] {
  const seen = new Set<string>();
  const groups = new Map<string, { strategyId: string; strategyName: string; tradingMode: TradeMode; days: Map<string, number>; pnls: number[] }>();
  for (const session of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const key = `${session.strategySnapshot.id}:${session.config.tradingMode}`;
    const group = groups.get(key) ?? { strategyId: session.strategySnapshot.id, strategyName: session.strategySnapshot.name, tradingMode: session.config.tradingMode, days: new Map<string, number>(), pnls: [] as number[] };
    groups.set(key, group);
    group.strategyName = session.strategySnapshot.name;
    if (!group.days.has(session.config.tradingDate)) group.days.set(session.config.tradingDate, 0);
    for (const trade of session.trades) {
      if (trade.status !== 'CLOSED' || seen.has(trade.orderId)) continue;
      seen.add(trade.orderId);
      group.pnls.push(trade.realizedNetPnl);
      group.days.set(session.config.tradingDate, group.days.get(session.config.tradingDate)! + trade.realizedNetPnl);
    }
  }
  return [...groups.values()].map((group) => {
    const wins = group.pnls.filter((pnl) => pnl > 0);
    const losses = group.pnls.filter((pnl) => pnl <= 0);
    const grossWin = wins.reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = -losses.reduce((sum, pnl) => sum + pnl, 0);
    return {
      strategyId: group.strategyId,
      strategyName: group.strategyName,
      tradingMode: group.tradingMode,
      tradingDays: group.days.size,
      closedTrades: group.pnls.length,
      wins: wins.length,
      losses: losses.length,
      winRatePct: group.pnls.length ? round((wins.length / group.pnls.length) * 100) : null,
      netPnl: round(grossWin - grossLoss),
      averageWin: wins.length ? round(grossWin / wins.length) : null,
      averageLoss: losses.length ? round(-grossLoss / losses.length) : null,
      largestLoss: round(Math.min(0, ...group.pnls)),
      worstDayPnl: round(Math.min(0, ...group.days.values())),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    };
  }).sort((a, b) => b.netPnl - a.netPnl);
}

/**
 * Starts the day's Testing sessions unattended: one strategy on the main Testing account (ROUND_ROBIN /
 * FIXED) or every strategy in its own isolated lane (PARALLEL). Every start goes through a DailyBotService,
 * so the same preflight, caps, day budgets and recovery rules apply as for a manual start.
 */
@Injectable()
export class DailyBotAutopilotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyBotAutopilotService.name);
  public readonly storagePath: string;
  private state: AutopilotState;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    @Inject(DailyBotService) private readonly dailyBot: DailyBotService,
    @Inject(DailyBotStore) private readonly dailyBotStore: DailyBotStore,
    @Inject(StrategiesService) private readonly strategies: StrategiesService,
    @Inject(EnvService) private readonly env: EnvService,
    @Optional() @Inject(TradingModeService) private readonly mode?: TradingModeService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService,
    @Optional() @Inject('AUTOPILOT_STORAGE_PATH') storagePath?: string,
    @Optional() @Inject(PaperLanesService) private readonly lanes?: PaperLanesService,
    @Optional() @Inject(RiskReservationManager) private readonly accountRisk?: RiskReservationManager,
  ) {
    this.storagePath = path.resolve(storagePath || path.join(env.config.STATE_DIRECTORY ?? '.data', 'autopilot.json'));
    this.state = this.load();
  }

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.logger.error(error instanceof Error ? error.message : String(error)));
    }, 30_000);
    this.timer.unref?.();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private load(): AutopilotState {
    try {
      return AutopilotStateSchema.parse(JSON.parse(fs.readFileSync(this.storagePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, schedule: null, rotationIndex: 0, runs: [] };
      throw new ServiceUnavailableException('Autopilot storage could not be read or validated. Restore or remove the saved file before starting the API.');
    }
  }

  private commit(next: AutopilotState): void {
    const parsed = AutopilotStateSchema.parse({ ...next, runs: next.runs.slice(-MAX_RUN_HISTORY) });
    const directory = path.dirname(this.storagePath);
    const temporary = path.join(directory, `.autopilot-${randomUUID()}.tmp`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(parsed)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.storagePath);
    this.state = parsed;
  }

  public getStatus(): AutopilotStatus {
    const tradingDate = dailyBotTradingDate();
    const schedule = this.state.schedule;
    return {
      schedule: structuredClone(schedule),
      today: structuredClone(this.state.runs.find((run) => run.tradingDate === tradingDate) ?? null),
      nextStrategyId: schedule && schedule.rotation !== 'PARALLEL' ? this.pickStrategy(schedule)?.strategy.id ?? null : null,
      recentRuns: structuredClone(this.state.runs.slice(-20).reverse()),
      scorecard: buildStrategyScorecard([...this.dailyBotStore.snapshot().sessions, ...(this.lanes?.getLanes().flatMap((lane) => lane.store.snapshot().sessions) ?? [])]),
      lanes: this.lanes?.snapshot(tradingDate) ?? [],
    };
  }

  /** Stops new entries in every parallel lane; emergency also requests exits for open virtual positions. */
  public async stopLanes(emergency = false): Promise<AutopilotStatus> {
    await this.lanes?.stopAll(emergency);
    return this.getStatus();
  }

  public update(input: unknown): AutopilotStatus {
    const parsed = AutopilotUpdateRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid Autopilot schedule', errors: parsed.error.flatten() });
    const request = parsed.data;
    if (new Set(request.strategyIds).size !== request.strategyIds.length) throw new BadRequestException('Each strategy may appear only once in the rotation.');
    const config = DailyBotConfigSchema.safeParse({ ...request.template, name: 'Autopilot', tradingDate: dailyBotTradingDate(), strategyId: request.strategyIds[0], tradingMode: TradeMode.PAPER });
    if (!config.success) throw new BadRequestException({ message: 'Invalid Autopilot risk template', errors: config.error.flatten() });
    const caps = this.env.config;
    const template = request.template;
    if (template.dailyCapitalBudget > caps.MAX_ACCOUNT_CAPITAL_INR || template.maxCapitalPerTrade > caps.MAX_ACCOUNT_CAPITAL_INR || template.perTradeMaxLossAllIn > caps.MAX_ALL_IN_TRADE_RISK_INR || template.dailyMaxLossAllIn > caps.MAX_DAILY_DRAWDOWN_INR) {
      throw new BadRequestException('The Autopilot template exceeds the configured account capital or risk limits.');
    }
    if (request.autoStartTime < '09:15' || request.autoStartTime >= template.lastEntryTime) {
      throw new BadRequestException('Auto-start time must be between 09:15 IST and the last entry time.');
    }
    const known = new Map(this.strategies.getAllStrategies().map((strategy) => [strategy.id, strategy]));
    const missing = request.strategyIds.filter((id) => !known.has(id));
    if (missing.length) throw new BadRequestException(`Unknown strategies: ${missing.join(', ')}.`);
    if (request.enabled) {
      if (!request.operatorConsent) throw new BadRequestException('Enabling Autopilot requires explicit operator consent for unattended Testing sessions.');
      const unauthorized = request.strategyIds.map((id) => known.get(id)!).filter((strategy) => !isAuthorized(strategy));
      if (unauthorized.length) {
        throw new BadRequestException(`These strategies are not authorized for trading: ${unauthorized.map((strategy) => `${strategy.name} (${strategy.status})`).join(', ')}. Backtest them and promote them to Paper Active first.`);
      }
    }
    const previous = this.state.schedule;
    const now = new Date().toISOString();
    const schedule: AutopilotSchedule = {
      enabled: request.enabled,
      tradingMode: TradeMode.PAPER,
      strategyIds: request.strategyIds,
      rotation: request.rotation,
      autoStartTime: request.autoStartTime,
      template,
      consentRecordedAt: request.enabled ? now : null,
      updatedAt: now,
    };
    const rotationChanged = JSON.stringify(previous?.strategyIds) !== JSON.stringify(schedule.strategyIds);
    this.commit({ ...this.state, schedule, rotationIndex: rotationChanged ? 0 : this.state.rotationIndex });
    this.logger.log(`[Autopilot] Schedule ${schedule.enabled ? 'ENABLED' : 'saved disabled'}: ${schedule.strategyIds.length} strategies, ${schedule.rotation}, start ${schedule.autoStartTime} IST.`);
    return this.getStatus();
  }

  /** Stops future unattended starts. Sessions already running continue until stopped. */
  public disable(): AutopilotStatus {
    if (this.state.schedule?.enabled) {
      this.commit({ ...this.state, schedule: { ...this.state.schedule, enabled: false, consentRecordedAt: null, updatedAt: new Date().toISOString() } });
    }
    return this.getStatus();
  }

  private pickStrategy(schedule: AutopilotSchedule): { strategy: StrategyConfig; index: number } | null {
    const known = new Map(this.strategies.getAllStrategies().map((strategy) => [strategy.id, strategy]));
    const count = schedule.strategyIds.length;
    const first = schedule.rotation === 'FIXED' ? 0 : this.state.rotationIndex % count;
    for (let offset = 0; offset < count; offset++) {
      const index = (first + offset) % count;
      const strategy = known.get(schedule.strategyIds[index]!);
      if (strategy && isAuthorized(strategy)) return { strategy, index };
    }
    return null;
  }

  private saveRun(run: AutopilotRun, extra: Partial<AutopilotState> = {}): void {
    const runs = this.state.runs.filter((candidate) => candidate.tradingDate !== run.tradingDate);
    this.commit({ ...this.state, ...extra, runs: [...runs, run] });
  }

  private notify(severity: AlertSeverity, title: string, message: string): void {
    this.notifications?.dispatchAlert({ severity, category: 'SYSTEM', title, message });
  }

  public async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // The account kill switch freezes every lane, whether or not Autopilot is still enabled.
      if (this.accountRisk?.isKillSwitchActive() && this.lanes) {
        const paused = await this.lanes.pauseAll();
        if (paused) this.notify(AlertSeverity.WARNING, 'Parallel Testing lanes paused', `Kill switch active: new entries paused in ${paused} lane(s). Open virtual positions stay protected.`);
      }
      const schedule = this.state.schedule;
      if (!schedule?.enabled) return;
      const tradingDate = dailyBotTradingDate(now);
      const time = istTime(now);
      if (!isTradingDate(tradingDate) || time < schedule.autoStartTime) return;
      const existing = this.state.runs.find((run) => run.tradingDate === tradingDate);
      if (existing?.status === 'MISSED') return;
      if (existing?.status === 'STARTED') {
        if (time < schedule.template.lastEntryTime) await this.resumeAfterRestart(existing, now);
        return;
      }
      if (time >= schedule.template.lastEntryTime) {
        const lanes = (existing?.lanes ?? []).map((lane) => lane.status === 'STARTED' ? lane : { ...lane, status: 'MISSED' as const });
        const anyStarted = lanes.some((lane) => lane.status === 'STARTED');
        const message = anyStarted ? `Entry window closed. Not started: ${lanes.filter((lane) => lane.status === 'MISSED').map((lane) => `${lane.strategyName} (${lane.message})`).join('; ')}`
          : existing ? `Entry window closed before a session could start. Last reason: ${existing.message}` : 'The API was not running during the entry window; no session was started.';
        this.saveRun({ tradingDate, status: anyStarted ? 'STARTED' : 'MISSED', strategyId: existing?.strategyId ?? null, strategyName: existing?.strategyName ?? null, setupId: existing?.setupId ?? null, sessionId: null, attempts: existing?.attempts ?? 0, lastAttemptAt: existing?.lastAttemptAt ?? null, message, lanes });
        this.notify(AlertSeverity.WARNING, anyStarted ? 'Autopilot could not start every strategy' : 'Autopilot missed today', message);
        return;
      }
      if (existing?.lastAttemptAt && now.getTime() - Date.parse(existing.lastAttemptAt) < RETRY_INTERVAL_MS) return;
      if (schedule.rotation === 'PARALLEL') await this.attemptParallel(schedule, tradingDate, existing, now);
      else await this.attemptStart(schedule, tradingDate, existing, now);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Starts one strategy in one Daily Bot (the main Testing account or an isolated lane). A paused, flat
   * Testing session from an earlier day (e.g. daily loss limit reached) is finished business and is
   * stopped first; ERROR sessions and anything holding exposure or a pending entry still need the owner.
   */
  private async startIn(bot: DailyBotService, schedule: AutopilotSchedule, strategy: StrategyConfig, tradingDate: string, priorSetupId: string | null):
    Promise<{ started: boolean; setupId: string | null; sessionId: string | null; message: string }> {
    let active = bot.getToday().activeSession;
    if (active && active.status === 'PAUSED' && active.config.tradingMode === TradeMode.PAPER && active.config.tradingDate < tradingDate
      && active.pendingProposalId === null && active.trades.every((trade) => trade.status === 'CLOSED')) {
      try {
        await bot.stop(active.id);
        this.logger.log(`[Autopilot] Closed out paused Testing session ${active.id} from ${active.config.tradingDate}.`);
      } catch (error) {
        return { started: false, setupId: priorSetupId, sessionId: null, message: `Could not close out the paused session from ${active.config.tradingDate}: ${describeFailure(error)}` };
      }
      active = bot.getToday().activeSession;
    }
    if (active) return { started: false, setupId: priorSetupId, sessionId: null, message: `Daily Bot session ${active.id} (${active.status}) is active or unresolved. Autopilot will start after it is reviewed or finished.` };

    // Reuse today's setup only while it still captures the strategy's current version.
    let setupId = bot.getSetups().find((setup) => setup.id === priorSetupId && setup.config.strategyId === strategy.id && setup.strategySnapshot.versionHash === strategy.versionHash)?.id ?? null;
    try {
      if (!setupId) {
        setupId = (await bot.createSetup({ ...schedule.template, name: `Autopilot · ${strategy.name}`.slice(0, 100), tradingDate, strategyId: strategy.id, tradingMode: TradeMode.PAPER })).id;
      }
      const session = await bot.start(setupId, { operatorConsent: true });
      return { started: true, setupId, sessionId: session.id, message: `Started Testing session with '${strategy.name}' v${strategy.version}.` };
    } catch (error) {
      return { started: false, setupId, sessionId: null, message: `Start blocked: ${describeFailure(error)}` };
    }
  }

  private blockedGlobally(): string | null {
    if ((this.mode?.getMode() ?? TradeMode.PAPER) !== TradeMode.PAPER) return 'The global mode is Live. Autopilot only starts Testing sessions; switch to Testing or start Live sessions manually.';
    if (this.accountRisk?.isKillSwitchActive()) return 'The account kill switch is active. Autopilot starts nothing until it is reset.';
    return null;
  }

  private async attemptStart(schedule: AutopilotSchedule, tradingDate: string, existing: AutopilotRun | undefined, now: Date): Promise<void> {
    const attempts = (existing?.attempts ?? 0) + 1;
    const waiting = (message: string, picked?: StrategyConfig, setupId: string | null = null) => {
      this.saveRun({ tradingDate, status: 'WAITING', strategyId: picked?.id ?? null, strategyName: picked?.name ?? null, setupId, sessionId: null, attempts, lastAttemptAt: now.toISOString(), message, lanes: [] });
      if (attempts === 1) this.notify(AlertSeverity.WARNING, 'Autopilot is waiting to start', `${message} Retrying every minute until ${schedule.template.lastEntryTime} IST.`);
    };
    const blocked = this.blockedGlobally();
    if (blocked) return waiting(blocked);
    const picked = this.pickStrategy(schedule);
    if (!picked) return waiting('None of the scheduled strategies is currently authorized. Promote at least one to Paper Active.');
    const { strategy, index } = picked;
    const result = await this.startIn(this.dailyBot, schedule, strategy, tradingDate, existing?.strategyId === strategy.id ? existing.setupId : null);
    if (!result.started) return waiting(result.message, strategy, result.setupId);
    const message = `${result.message.slice(0, -1)} at ${istTime(now)} IST.`;
    this.saveRun({ tradingDate, status: 'STARTED', strategyId: strategy.id, strategyName: strategy.name, setupId: result.setupId, sessionId: result.sessionId, attempts, lastAttemptAt: now.toISOString(), message, lanes: [] },
      schedule.rotation === 'ROUND_ROBIN' ? { rotationIndex: (index + 1) % schedule.strategyIds.length } : {});
    this.logger.log(`[Autopilot] ${message}`);
    this.notify(AlertSeverity.INFO, 'Autopilot started today\'s session', message);
  }

  /** PARALLEL: every authorized strategy starts in its own isolated virtual account. */
  private async attemptParallel(schedule: AutopilotSchedule, tradingDate: string, existing: AutopilotRun | undefined, now: Date): Promise<void> {
    const attempts = (existing?.attempts ?? 0) + 1;
    const save = (status: AutopilotRun['status'], message: string, lanes: AutopilotLaneRun[]) =>
      this.saveRun({ tradingDate, status, strategyId: null, strategyName: null, setupId: null, sessionId: null, attempts, lastAttemptAt: now.toISOString(), message, lanes });
    const blocked = this.blockedGlobally() ?? (this.lanes ? null : 'Parallel paper lanes are unavailable in this deployment.');
    if (blocked) {
      save('WAITING', blocked, existing?.lanes ?? []);
      if (attempts === 1) this.notify(AlertSeverity.WARNING, 'Autopilot is waiting to start', `${blocked} Retrying every minute until ${schedule.template.lastEntryTime} IST.`);
      return;
    }
    const known = new Map(this.strategies.getAllStrategies().map((strategy) => [strategy.id, strategy]));
    const authorized = schedule.strategyIds.map((id) => known.get(id)).filter((strategy): strategy is StrategyConfig => Boolean(strategy && isAuthorized(strategy)));
    if (authorized.length === 0) {
      save('WAITING', 'None of the scheduled strategies is currently authorized. Promote at least one to Paper Active.', existing?.lanes ?? []);
      return;
    }
    const lanes: AutopilotLaneRun[] = [];
    const startedNow: string[] = [];
    const failedNow: string[] = [];
    for (const strategy of authorized) {
      const prior = existing?.lanes.find((lane) => lane.strategyId === strategy.id);
      if (prior?.status === 'STARTED') { lanes.push(prior); continue; }
      let result: Awaited<ReturnType<DailyBotAutopilotService['startIn']>>;
      try {
        result = await this.startIn(this.lanes!.getLane(strategy.id).dailyBot, schedule, strategy, tradingDate, prior?.setupId ?? null);
      } catch (error) {
        result = { started: false, setupId: prior?.setupId ?? null, sessionId: null, message: `Lane unavailable: ${describeFailure(error)}` };
      }
      lanes.push({ strategyId: strategy.id, strategyName: strategy.name, status: result.started ? 'STARTED' : 'WAITING', setupId: result.setupId, sessionId: result.sessionId, attempts: (prior?.attempts ?? 0) + 1, message: result.message });
      (result.started ? startedNow : failedNow).push(strategy.name);
    }
    const started = lanes.filter((lane) => lane.status === 'STARTED').length;
    const allStarted = started === lanes.length;
    save(allStarted ? 'STARTED' : 'WAITING', `${started} of ${lanes.length} strategies running in parallel Testing lanes${allStarted ? '' : '; retrying the rest every minute'}.`, lanes);
    if (startedNow.length) this.notify(AlertSeverity.INFO, 'Autopilot started parallel Testing', `Started at ${istTime(now)} IST: ${startedNow.join(', ')}.`);
    if (failedNow.length && attempts === 1) this.notify(AlertSeverity.WARNING, 'Autopilot is waiting to start some strategies', `${failedNow.join(', ')} could not start yet. Retrying every minute until ${schedule.template.lastEntryTime} IST.`);
  }

  /** A restart pauses running sessions; resume a Testing session Autopilot started once preflight passes again. Returns a status message when it acted. */
  private async resumeIfRecovering(bot: DailyBotService, sessionId: string, now: Date): Promise<string | null> {
    let session: DailyBotSession;
    try { session = bot.getSession(sessionId); } catch { return null; }
    const lastEvent = session.events[session.events.length - 1];
    if (session.status !== 'PAUSED' || session.config.tradingMode !== TradeMode.PAPER || lastEvent?.type !== 'RECOVERY_REQUIRED') return null;
    try {
      await bot.resume(session.id);
      this.notify(AlertSeverity.INFO, 'Autopilot resumed after restart', `Testing session '${session.strategySnapshot.name}' resumed after a fresh preflight.`);
      return `Resumed after API restart at ${istTime(now)} IST.`;
    } catch (error) {
      return `Restart recovery waiting: ${describeFailure(error)}`;
    }
  }

  private async resumeAfterRestart(run: AutopilotRun, now: Date): Promise<void> {
    if (run.lastAttemptAt && now.getTime() - Date.parse(run.lastAttemptAt) < RETRY_INTERVAL_MS) return;
    if (this.accountRisk?.isKillSwitchActive()) return;
    if (run.lanes.length === 0) {
      const message = run.sessionId ? await this.resumeIfRecovering(this.dailyBot, run.sessionId, now) : null;
      if (message) this.saveRun({ ...run, lastAttemptAt: now.toISOString(), message });
      return;
    }
    if (!this.lanes) return;
    let changed = false;
    const lanes = [];
    for (const lane of run.lanes) {
      const message = lane.status === 'STARTED' && lane.sessionId ? await this.resumeIfRecovering(this.lanes.getLane(lane.strategyId).dailyBot, lane.sessionId, now) : null;
      if (message) changed = true;
      lanes.push(message ? { ...lane, message } : lane);
    }
    if (changed) this.saveRun({ ...run, lanes, lastAttemptAt: now.toISOString() });
  }
}
