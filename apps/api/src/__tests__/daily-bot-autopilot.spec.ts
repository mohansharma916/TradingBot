// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AllowedOptionType, DailyBotSession, DailyBotSessionSchema, MoneynessType, StrategyConfig, StrategyStatus, TradeMode } from '@trading-bot/contracts';
import { DailyBotStore } from '../daily-bot/daily-bot.store';
import { DailyBotService } from '../daily-bot/daily-bot.service';
import { DailyBotAutopilotService, buildStrategyScorecard } from '../daily-bot/daily-bot-autopilot.service';

function strategy(id: string, name: string, status = StrategyStatus.PAPER_ACTIVE): StrategyConfig {
  return {
    id, name, version: 1, versionHash: `${id}-v1`,
    status, tradeMode: TradeMode.PAPER, market: 'NSE_FO', underlying: 'NIFTY',
    allowedInstruments: [AllowedOptionType.LONG_CALL], timeframe: '5m',
    session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
    entry: { emaPeriod: 20, rsiPeriod: 14, rsiThreshold: 55, maxBidAskSpreadPct: 1, minVolume: 1000 },
    selection: { expiry: 'NEAREST_ELIGIBLE', moneyness: MoneynessType.ATM, minVolume: 1000 },
    risk: { maxCapitalInr: 10000, maxAllInTradeLossInr: 500, maxAllInDailyLossInr: 1500, maxOpenPositions: 1, maxTradesPerDay: 3, targetNetProfitInr: 300, maxRoundTripCostBudgetInr: 60 },
    exit: { stopBasis: 'OPTION_PREMIUM', marketCutoff: '15:10' },
    maxCapitalInr: 10000, maxAllInTradeLossInr: 500, maxAllInDailyLossInr: 1500,
    targetNetProfitInr: 300, maxRoundTripCostBudgetInr: 60, maxOpenPositions: 1, requiresApproval: true,
  };
}

const template = { dailyCapitalBudget: 10000, dailyMaxLossAllIn: 1000, perTradeMaxLossAllIn: 500, maxCapitalPerTrade: 5000 };
// 2026-10-14 is a Wednesday; 03:50Z is 09:20 IST.
const istAt = (date: string, time: string) => new Date(new Date(`${date}T${time}:00.000Z`).getTime() - 330 * 60_000);

describe('Daily Bot Autopilot scheduler', () => {
  let directory: string;
  let store: DailyBotStore;
  let strategies: StrategyConfig[];
  let mode: TradeMode;
  let execution: Record<string, ReturnType<typeof vi.fn>>;
  let dailyBot: DailyBotService;
  let autopilot: DailyBotAutopilotService;
  let alerts: { dispatchAlert: ReturnType<typeof vi.fn> };
  const trend = randomUUID();
  const vwap = randomUUID();
  const draft = randomUUID();
  const env = { config: { MAX_ACCOUNT_CAPITAL_INR: 10000, MAX_ALL_IN_TRADE_RISK_INR: 500, MAX_DAILY_DRAWDOWN_INR: 1500 } };

  const strategyService = () => ({
    getStrategy: (id: string) => strategies.find((item) => item.id === id),
    getAllStrategies: () => strategies,
  });
  const makeDailyBot = () => new DailyBotService(store, execution as any, strategyService() as any, env as any,
    { getAvailableCash: () => 10000, arm: vi.fn(), disarm: vi.fn() } as any, { getMode: () => mode } as any);
  let killSwitch = false;
  let laneBots: Map<string, { strategyId: string; store: DailyBotStore; dailyBot: DailyBotService }>;
  let lanes: Record<string, any>;
  const makeAutopilot = () => new DailyBotAutopilotService(dailyBot, store, strategyService() as any,
    { config: { ...env.config, STATE_DIRECTORY: directory } } as any, { getMode: () => mode } as any, alerts as any,
    undefined, lanes as any, { isKillSwitchActive: () => killSwitch } as any);
  const enable = (overrides: Record<string, unknown> = {}) => autopilot.update({
    enabled: true, operatorConsent: true, strategyIds: [trend, vwap], rotation: 'ROUND_ROBIN', autoStartTime: '09:20', template, ...overrides,
  });
  const at = async (date: string, time: string) => {
    vi.setSystemTime(istAt(date, time));
    await autopilot.tick(new Date());
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(istAt('2026-10-14', '08:00'));
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-'));
    store = new DailyBotStore(path.join(directory, 'daily-bot.json'));
    strategies = [strategy(trend, 'Triple Confirmation Trend'), strategy(vwap, 'VWAP Surge'), strategy(draft, 'Untested idea', StrategyStatus.DRAFT)];
    mode = TradeMode.PAPER;
    alerts = { dispatchAlert: vi.fn() };
    execution = {
      preflight: vi.fn(async () => ({ passed: true, evaluatedAt: new Date().toISOString(), checks: [] })),
      tick: vi.fn(async () => undefined),
      approveEntry: vi.fn(async () => undefined),
      restoreDailyLedger: vi.fn(() => new Set<string>()),
      stop: vi.fn(async (session: DailyBotSession) => { session.status = 'STOPPED'; session.stoppedAt = new Date().toISOString(); }),
    };
    killSwitch = false;
    laneBots = new Map();
    lanes = {
      getLane: (id: string) => {
        if (!laneBots.has(id)) {
          const laneStore = new DailyBotStore(path.join(directory, `lane-${id}.json`));
          laneBots.set(id, { strategyId: id, store: laneStore, dailyBot: new DailyBotService(laneStore, execution as any, strategyService() as any, env as any, { getAvailableCash: () => 10000, arm: vi.fn(), disarm: vi.fn() } as any) });
        }
        return laneBots.get(id)!;
      },
      getLanes: () => [...laneBots.values()],
      snapshot: () => [],
      pauseAll: vi.fn(async () => 0),
      stopAll: vi.fn(async () => undefined),
    };
    dailyBot = makeDailyBot();
    autopilot = makeAutopilot();
  });

  afterEach(() => {
    for (const lane of laneBots.values()) lane.dailyBot.onModuleDestroy();
    dailyBot.onModuleDestroy();
    autopilot.onModuleDestroy();
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('requires consent, authorized strategies and account-cap compliance before enabling', () => {
    expect(() => enable({ operatorConsent: false })).toThrow('explicit operator consent');
    expect(autopilot.update({ enabled: false, strategyIds: [trend], template }).schedule?.rotation).toBe('PARALLEL');
    expect(() => enable({ strategyIds: [trend, draft] })).toThrow('Untested idea (DRAFT)');
    expect(() => enable({ template: { ...template, perTradeMaxLossAllIn: 900, dailyMaxLossAllIn: 1000 } })).toThrow();
    expect(() => enable({ strategyIds: [trend, trend] })).toThrow('only once');
    expect(() => enable({ autoStartTime: '15:00' })).toThrow('Auto-start time');

    const status = enable();
    expect(status.schedule).toMatchObject({ enabled: true, tradingMode: TradeMode.PAPER, rotation: 'ROUND_ROBIN', strategyIds: [trend, vwap] });
    expect(status.schedule?.consentRecordedAt).toBeTruthy();
    expect(status.nextStrategyId).toBe(trend);
    // Persisted across restarts.
    expect(makeAutopilot().getStatus().schedule?.enabled).toBe(true);
  });

  it('starts nothing before the scheduled time, on weekends or on exchange holidays', async () => {
    enable();
    await at('2026-10-14', '09:19');
    await at('2026-10-17', '10:00'); // Saturday
    await at('2026-10-20', '10:00'); // Dussehra
    expect(store.snapshot().sessions).toHaveLength(0);
    expect(autopilot.getStatus().recentRuns).toHaveLength(0);
  });

  it('starts a Testing session at the scheduled time and rotates strategies across trading days', async () => {
    enable();
    await at('2026-10-14', '09:20');
    const first = autopilot.getStatus();
    expect(first.today).toMatchObject({ status: 'STARTED', strategyId: trend, attempts: 1 });
    const [session] = store.snapshot().sessions;
    expect(session).toMatchObject({ status: 'RUNNING', config: { tradingMode: TradeMode.PAPER, tradingDate: '2026-10-14', strategyId: trend, dailyMaxLossAllIn: 1000 } });
    expect(first.nextStrategyId).toBe(vwap);
    expect(alerts.dispatchAlert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('started') }));

    // Later ticks the same day neither start another session nor touch the running one.
    await at('2026-10-14', '11:00');
    expect(store.snapshot().sessions).toHaveLength(1);

    await dailyBot.stop(session!.id);
    await at('2026-10-15', '09:21');
    expect(autopilot.getStatus().today).toMatchObject({ status: 'STARTED', strategyId: vwap });
    expect(store.snapshot().sessions.map((item) => item.config.strategyId)).toEqual([trend, vwap]);
  });

  it('closes out an earlier day\'s paused, flat Testing session so the next day can start', async () => {
    enable();
    await at('2026-10-14', '09:20');
    const [first] = store.snapshot().sessions;
    await dailyBot.pause(first!.id); // e.g. daily loss limit reached
    await at('2026-10-15', '09:20');
    const sessions = store.snapshot().sessions;
    expect(sessions[0]).toMatchObject({ id: first!.id, status: 'STOPPED' });
    expect(sessions[1]).toMatchObject({ status: 'RUNNING', config: { tradingDate: '2026-10-15', strategyId: vwap } });
  });

  it('skips a strategy that lost authorization and keeps FIXED rotation on the first authorized one', async () => {
    enable({ rotation: 'FIXED' });
    strategies[0]!.status = StrategyStatus.PAUSED;
    await at('2026-10-14', '09:20');
    expect(autopilot.getStatus().today).toMatchObject({ status: 'STARTED', strategyId: vwap });
  });

  it('waits and retries every minute while preflight fails, naming the failed checks', async () => {
    enable();
    execution.preflight!.mockResolvedValue({ passed: false, evaluatedAt: new Date().toISOString(), checks: [{ id: 'market-data', label: 'Fresh market data', passed: false, message: 'Connect Upstox.' }] });
    await at('2026-10-14', '09:20');
    expect(autopilot.getStatus().today).toMatchObject({ status: 'WAITING', attempts: 1, message: expect.stringContaining('Fresh market data: Connect Upstox.') });
    expect(alerts.dispatchAlert).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 30_000));
    await autopilot.tick(new Date());
    expect(autopilot.getStatus().today?.attempts).toBe(1);

    execution.preflight!.mockResolvedValue({ passed: true, evaluatedAt: new Date().toISOString(), checks: [] });
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await autopilot.tick(new Date());
    expect(autopilot.getStatus().today).toMatchObject({ status: 'STARTED', attempts: 2 });
    expect(store.snapshot().setups).toHaveLength(1); // the waiting setup was reused
    expect(alerts.dispatchAlert).toHaveBeenCalledTimes(2);
  });

  it('never starts a Live session and does not displace an active manual session', async () => {
    enable();
    mode = TradeMode.APPROVAL;
    await at('2026-10-14', '09:20');
    expect(autopilot.getStatus().today).toMatchObject({ status: 'WAITING', message: expect.stringContaining('only starts Testing') });
    expect(store.snapshot().sessions).toHaveLength(0);

    mode = TradeMode.PAPER;
    const manual = await dailyBot.createSetup({ ...template, name: 'Manual', tradingDate: '2026-10-14', strategyId: vwap });
    await dailyBot.start(manual.id, { operatorConsent: true });
    await at('2026-10-14', '09:22');
    expect(autopilot.getStatus().today?.message).toContain('is active or unresolved');
    expect(store.snapshot().sessions).toHaveLength(1);
  });

  it('records a missed day once the entry window closes without a start', async () => {
    enable();
    await at('2026-10-14', '14:45');
    expect(autopilot.getStatus().today).toMatchObject({ status: 'MISSED' });
    await at('2026-10-14', '14:50');
    expect(store.snapshot().sessions).toHaveLength(0);
  });

  it('stops scheduling when disabled without stopping a running session', async () => {
    enable();
    await at('2026-10-14', '09:20');
    expect(autopilot.disable().schedule).toMatchObject({ enabled: false, consentRecordedAt: null });
    expect(store.snapshot().sessions[0]!.status).toBe('RUNNING');
    await dailyBot.stop(store.snapshot().sessions[0]!.id);
    await at('2026-10-15', '09:30');
    expect(store.snapshot().sessions).toHaveLength(1);
  });

  it('resumes its own Testing session after an API restart once preflight passes', async () => {
    enable();
    await at('2026-10-14', '09:20');
    dailyBot.onModuleDestroy();
    dailyBot = makeDailyBot(); // restart: recovery pauses the running session
    expect(store.snapshot().sessions[0]).toMatchObject({ status: 'PAUSED' });
    autopilot = makeAutopilot();
    await at('2026-10-14', '09:40');
    expect(store.snapshot().sessions[0]).toMatchObject({ status: 'RUNNING' });
    expect(autopilot.getStatus().today?.message).toContain('Resumed after API restart');
  });

  describe('PARALLEL', () => {
    const laneSessions = (id: string) => laneBots.get(id)?.store.snapshot().sessions ?? [];

    it('starts every authorized strategy the same day, each in its own lane, without touching the main account', async () => {
      enable({ rotation: 'PARALLEL' });
      await at('2026-10-14', '09:20');
      const status = autopilot.getStatus();
      expect(status.today).toMatchObject({ status: 'STARTED', lanes: [{ strategyId: trend, status: 'STARTED' }, { strategyId: vwap, status: 'STARTED' }] });
      expect(store.snapshot().sessions).toHaveLength(0);
      expect(laneSessions(trend)).toEqual([expect.objectContaining({ status: 'RUNNING', config: expect.objectContaining({ strategyId: trend, tradingMode: TradeMode.PAPER }) })]);
      expect(laneSessions(vwap)).toEqual([expect.objectContaining({ status: 'RUNNING', config: expect.objectContaining({ strategyId: vwap }) })]);
      expect(status.nextStrategyId).toBeNull();

      // Next trading day: yesterday's lanes are stopped by the operator, both start again.
      for (const id of [trend, vwap]) await laneBots.get(id)!.dailyBot.stop(laneSessions(id)[0]!.id);
      await at('2026-10-15', '09:20');
      expect(laneSessions(trend)).toHaveLength(2);
      expect(laneSessions(vwap)).toHaveLength(2);
    });

    it('retries only the lanes that failed preflight and reports partial starts at the entry cutoff', async () => {
      enable({ rotation: 'PARALLEL' });
      execution.preflight!.mockImplementation(async (config: { strategyId: string }) => config.strategyId === vwap
        ? { passed: false, evaluatedAt: new Date().toISOString(), checks: [{ id: 'market-data', label: 'Fresh market data', passed: false, message: 'Stale.' }] }
        : { passed: true, evaluatedAt: new Date().toISOString(), checks: [] });
      await at('2026-10-14', '09:20');
      expect(autopilot.getStatus().today).toMatchObject({ status: 'WAITING', lanes: [{ strategyId: trend, status: 'STARTED' }, { strategyId: vwap, status: 'WAITING', message: expect.stringContaining('Fresh market data: Stale.') }] });

      await at('2026-10-14', '09:22');
      expect(laneSessions(trend)).toHaveLength(1); // the running lane is not restarted
      expect(laneBots.get(vwap)!.store.snapshot().setups).toHaveLength(1); // the waiting setup is reused

      await at('2026-10-14', '14:45');
      expect(autopilot.getStatus().today).toMatchObject({ status: 'STARTED', lanes: [{ status: 'STARTED' }, { strategyId: vwap, status: 'MISSED' }], message: expect.stringContaining('Not started: VWAP Surge') });
    });

    it('starts nothing and pauses running lanes while the account kill switch is active', async () => {
      enable({ rotation: 'PARALLEL' });
      killSwitch = true;
      await at('2026-10-14', '09:20');
      expect(lanes.pauseAll).toHaveBeenCalled();
      expect(autopilot.getStatus().today).toMatchObject({ status: 'WAITING', message: expect.stringContaining('kill switch') });
      expect(laneBots.size).toBe(0);
    });

    it('includes lane sessions in the scorecard and exposes lane stop controls', async () => {
      enable({ rotation: 'PARALLEL' });
      await at('2026-10-14', '09:20');
      expect(autopilot.getStatus().scorecard.map((row) => row.strategyId).sort()).toEqual([trend, vwap].sort());
      await autopilot.stopLanes(true);
      expect(lanes.stopAll).toHaveBeenCalledWith(true);
    });
  });
});

describe('Strategy scorecard', () => {
  const base = (strategyId: string, name: string, tradingDate: string, startedAt: string, pnls: [string, number][]): DailyBotSession => {
    const s = strategy(strategyId, name);
    return DailyBotSessionSchema.parse({
      id: randomUUID(), setupId: randomUUID(), status: 'COMPLETED', startedAt, stoppedAt: null, lastHeartbeatAt: null, lastMessage: '',
      config: { name, tradingDate, dailyCapitalBudget: 10000, dailyMaxLossAllIn: 1000, perTradeMaxLossAllIn: 500, maxCapitalPerTrade: 5000, strategyId },
      strategySnapshot: s, tradesExecuted: pnls.length, pendingProposalId: null, events: [],
      trades: pnls.map(([orderId, pnl]) => ({ proposalId: orderId, orderId, instrumentKey: 'NSE_FO|1', symbol: 'X', quantity: 75, entryPrice: 100, currentPrice: 100, stopPrice: 90, peakNetProfit: 0, protectedNetProfit: 0, trailingActive: false, status: 'CLOSED', realizedNetPnl: pnl, estimatedCharges: 40 })),
    });
  };

  it('counts each closed order once, attributed to the session that recorded it first', () => {
    const a = randomUUID();
    const b = randomUUID();
    const scorecard = buildStrategyScorecard([
      // Second session the same day carries the earlier closed trade forward.
      base(b, 'B', '2026-10-14', '2026-10-14T06:00:00.000Z', [['o1', 400], ['o3', -200]]),
      base(a, 'A', '2026-10-14', '2026-10-14T04:00:00.000Z', [['o1', 400], ['o2', -100]]),
      base(a, 'A', '2026-10-15', '2026-10-15T04:00:00.000Z', [['o4', 250]]),
    ]);
    expect(scorecard.find((row) => row.strategyId === a)).toMatchObject({
      tradingDays: 2, closedTrades: 3, wins: 2, losses: 1, winRatePct: 66.67, netPnl: 550,
      averageWin: 325, averageLoss: -100, largestLoss: -100, worstDayPnl: 0, profitFactor: 6.5,
    });
    expect(scorecard.find((row) => row.strategyId === b)).toMatchObject({ closedTrades: 1, netPnl: -200, worstDayPnl: -200, profitFactor: 0 });
    expect(scorecard[0]!.strategyId).toBe(a);
  });
});
