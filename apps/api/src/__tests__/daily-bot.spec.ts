// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AllowedOptionType, DailyBotConfigSchema, DailyBotSession, DailyBotSessionSchema, DailyBotSetup, MoneynessType, StrategyConfig, StrategyStatus, TradeMode } from '@trading-bot/contracts';
import { DailyBotStore } from '../daily-bot/daily-bot.store';
import { DailyBotService, dailyBotTradingDate } from '../daily-bot/daily-bot.service';

const strategyId = '550e8400-e29b-41d4-a716-446655440002';
function strategy(): StrategyConfig {
  return {
    id: strategyId, name: 'Immutable strategy', version: 1, versionHash: 'version-one',
    status: StrategyStatus.PAPER_ACTIVE, tradeMode: TradeMode.PAPER, market: 'NSE_FO', underlying: 'NIFTY',
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

const configuration = (tradingDate = '2026-10-09') => DailyBotConfigSchema.parse({
  name: 'Conservative day', tradingDate, dailyCapitalBudget: 10000, dailyMaxLossAllIn: 1000,
  perTradeMaxLossAllIn: 500, maxCapitalPerTrade: 5000, strategyId,
});

function savedSetup(): DailyBotSetup {
  return { id: randomUUID(), createdAt: new Date().toISOString(), clonedFromId: null, config: configuration(), strategySnapshot: strategy() };
}

function sessionFor(setup: DailyBotSetup): DailyBotSession {
  return DailyBotSessionSchema.parse({
    id: randomUUID(), setupId: setup.id, config: setup.config, strategySnapshot: setup.strategySnapshot,
    status: 'RUNNING', startedAt: new Date().toISOString(), stoppedAt: null, lastHeartbeatAt: null,
    lastMessage: 'Started', tradesExecuted: 0, pendingProposalId: null, trades: [], events: [],
  });
}

function trade(status: 'OPEN' | 'CLOSED' = 'OPEN') {
  return {
    proposalId: 'prop_daily_test', orderId: 'daily-order-1', instrumentKey: 'NSE_FO|TEST', symbol: 'TESTCE', quantity: 25,
    entryPrice: 100, currentPrice: 99, stopPrice: 90, peakNetProfit: 0, protectedNetProfit: -300,
    trailingActive: false, status, realizedNetPnl: status === 'CLOSED' ? -300 : 0, estimatedCharges: 50,
  };
}

describe('Daily Bot durable orchestration', () => {
  let directory: string;
  let storagePath: string;
  let store: DailyBotStore;
  let selectedStrategy: StrategyConfig;
  let execution: { preflight: ReturnType<typeof vi.fn>; tick: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; approveEntry: ReturnType<typeof vi.fn>; restoreDailyLedger: ReturnType<typeof vi.fn> };
  let service: DailyBotService;
  const env = { config: { MAX_ACCOUNT_CAPITAL_INR: 10000, MAX_ALL_IN_TRADE_RISK_INR: 500, MAX_DAILY_DRAWDOWN_INR: 1500 } };

  const instantiate = (nextStore = store) => new DailyBotService(nextStore, execution as any, {
    getStrategy: () => selectedStrategy,
    getAllStrategies: () => [selectedStrategy],
  } as any, env as any, { getAvailableCash: () => 10000, arm: vi.fn(), disarm: vi.fn() } as any);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T05:00:00.000Z'));
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-bot-test-'));
    storagePath = path.join(directory, 'state.json');
    store = new DailyBotStore(storagePath);
    selectedStrategy = strategy();
    execution = {
      preflight: vi.fn(async () => ({ passed: true, evaluatedAt: new Date().toISOString(), checks: [{ id: 'runtime', label: 'Runtime gates', passed: true, message: 'Passed' }] })),
      tick: vi.fn(async () => undefined),
      approveEntry: vi.fn(async () => undefined),
      restoreDailyLedger: vi.fn(() => new Set<string>()),
      stop: vi.fn(async (session: DailyBotSession, emergency: boolean) => {
        session.status = 'STOPPED';
        session.stoppedAt = new Date().toISOString();
        session.lastMessage = emergency ? 'Emergency exit confirmed' : 'Entries stopped; protection remains active';
      }),
    };
    service = instantiate();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('provides first-day state and uses IST on UTC date boundaries', () => {
    expect(service.getToday()).toMatchObject({ todaySetup: null, previousSetup: null, activeSession: null, setups: [], supportedModes: [TradeMode.PAPER, TradeMode.APPROVAL] });
    expect(dailyBotTradingDate(new Date('2026-10-09T18:29:59Z'))).toBe('2026-10-09');
    expect(dailyBotTradingDate(new Date('2026-10-09T18:30:00Z'))).toBe('2026-10-10');
  });

  it('durably captures immutable strategy/config and clones a new date without changing history', async () => {
    const saved = await service.createSetup(configuration());
    selectedStrategy.version = 2;
    selectedStrategy.versionHash = 'version-two';
    selectedStrategy.entry.rsiThreshold = 70;
    saved.config.dailyCapitalBudget = 6000;
    const cloned = await service.cloneSetup(saved.id, { tradingDate: '2026-10-12' });
    expect(cloned.id).not.toBe(saved.id);
    expect(cloned.clonedFromId).toBe(saved.id);
    expect(cloned.strategySnapshot.version).toBe(1);
    expect(cloned.strategySnapshot.entry.rsiThreshold).toBe(55);
    expect(cloned.config.dailyCapitalBudget).toBe(10000);
    const reopened = new DailyBotStore(storagePath);
    expect(reopened.snapshot().setups).toHaveLength(2);
    expect(reopened.snapshot().setups[0]?.config.tradingDate).toBe('2026-10-09');
    const illegal = reopened.snapshot();
    illegal.setups[0]!.config.name = 'Mutated history';
    expect(() => reopened.commit(illegal)).toThrow('immutable');
  });

  it('chooses the previous saved trading day across weekends and exchange holidays', async () => {
    const prior = await service.createSetup(configuration('2026-10-01'));
    await service.createSetup(configuration('2026-10-02'));
    await service.createSetup(configuration('2026-10-03'));
    vi.setSystemTime(new Date('2026-10-05T04:00:00Z'));
    expect(service.getToday().previousSetup?.id).toBe(prior.id);
  });

  it('restores a missing custom strategy at its highest saved version so copied risk configurations can be saved', async () => {
    const customId = randomUUID();
    const older = savedSetup();
    older.config.strategyId = customId;
    older.strategySnapshot.id = customId;
    older.strategySnapshot.name = 'Custom durable strategy';
    const newer = structuredClone(older);
    newer.id = randomUUID();
    newer.strategySnapshot.version = 3;
    newer.strategySnapshot.versionHash = 'custom-v3';
    store.commit({ version: 1, setups: [newer, older], sessions: [] });
    const registry = new Map([[strategyId, selectedStrategy]]);
    const registryService = {
      getAllStrategies: () => Array.from(registry.values()),
      getStrategy: (id: string) => registry.get(id),
      createStrategy: vi.fn((snapshot: StrategyConfig) => { registry.set(snapshot.id, structuredClone(snapshot)); return snapshot; }),
    };
    const restarted = new DailyBotService(new DailyBotStore(storagePath), execution as any, registryService as any, env as any, { getAvailableCash: () => 10000, arm: vi.fn(), disarm: vi.fn() } as any);
    expect(registryService.createStrategy).toHaveBeenCalledOnce();
    expect(restarted.getToday().strategies.find((candidate) => candidate.id === customId)?.version).toBe(3);
    const copied = await restarted.createSetup({ ...older.config, perTradeMaxLossAllIn: 400 });
    expect(copied.strategySnapshot.version).toBe(3);
    expect(copied.config.perTradeMaxLossAllIn).toBe(400);
    expect(store.snapshot().setups[0]?.strategySnapshot.version).toBe(3);
    expect(store.snapshot().setups[1]?.strategySnapshot.version).toBe(1);
  });

  it('keeps currently registered retired strategy versions authoritative during saved strategy restoration', async () => {
    const setup = savedSetup();
    store.commit({ version: 1, setups: [setup], sessions: [] });
    const retired = { ...selectedStrategy, status: StrategyStatus.RETIRED, version: 4 };
    const registryService = { getAllStrategies: () => [retired], getStrategy: () => retired, createStrategy: vi.fn() };
    const restarted = new DailyBotService(new DailyBotStore(storagePath), execution as any, registryService as any, env as any, { getAvailableCash: () => 10000, arm: vi.fn(), disarm: vi.fn() } as any);
    expect(registryService.createStrategy).not.toHaveBeenCalled();
    expect(restarted.getToday().strategies[0]).toMatchObject({ version: 4, status: StrategyStatus.RETIRED });
    expect(restarted.getSetups()[0]?.strategySnapshot.status).toBe(StrategyStatus.PAPER_ACTIVE);
    const preflight = await restarted.preflight(setup.id);
    expect(preflight.checks.find((check) => check.id === 'strategy-authorization')?.passed).toBe(false);
    await expect(restarted.start(setup.id, { operatorConsent: true })).rejects.toThrow('preflight failed');
  });

  it('rejects malformed config and configured account cap violations before saving', async () => {
    await expect(service.createSetup({ ...configuration(), dailyMaxLossAllIn: 100, perTradeMaxLossAllIn: 500 })).rejects.toThrow('Invalid Daily Bot');
    const lowCapService = new DailyBotService(store, execution as any, { getStrategy: strategy, getAllStrategies: () => [selectedStrategy] } as any,
      { config: { ...env.config, MAX_ACCOUNT_CAPITAL_INR: 6000 } } as any, { getAvailableCash: () => 6000, arm: vi.fn(), disarm: vi.fn() } as any);
    await expect(lowCapService.createSetup(configuration())).rejects.toThrow('account cap');
    expect(store.snapshot().setups).toEqual([]);
  });

  it('requires operator consent and passing current preflight; blocks old dates and live modes', async () => {
    const saved = await service.createSetup(configuration());
    await expect(service.start(saved.id, { operatorConsent: false })).rejects.toThrow('consent');
    execution.preflight.mockResolvedValueOnce({ passed: false, evaluatedAt: new Date().toISOString(), checks: [{ id: 'feed', label: 'Feed', passed: false, message: 'Stale' }] });
    await expect(service.start(saved.id, { operatorConsent: true })).rejects.toThrow('preflight failed');
    const old = await service.cloneSetup(saved.id, { tradingDate: '2026-10-08' });
    await expect(service.start(old.id, { operatorConsent: true })).rejects.toThrow('preflight failed');
    const live = await service.createSetup({ ...configuration(), tradingMode: TradeMode.AUTO });
    await expect(service.start(live.id, { operatorConsent: true, confirmationCode: 'ENABLE LIVE TRADING' })).rejects.toThrow('must match the global');
    expect(store.snapshot().sessions).toEqual([]);
  });

  it('serializes simultaneous starts so exactly one account session can run', async () => {
    const saved = await service.createSetup(configuration());
    const results = await Promise.allSettled([service.start(saved.id, { operatorConsent: true }), service.start(saved.id, { operatorConsent: true })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(store.snapshot().sessions).toHaveLength(1);
    expect(store.snapshot().sessions[0]?.status).toBe('RUNNING');
  });

  it('restores running sessions paused and requires explicit resume with fresh preflight', async () => {
    const saved = await service.createSetup(configuration());
    const started = await service.start(saved.id, { operatorConsent: true });
    const reopened = instantiate(new DailyBotStore(storagePath));
    expect(reopened.getSession(started.id).status).toBe('PAUSED');
    expect(reopened.getSession(started.id).events.at(-1)?.type).toBe('RECOVERY_REQUIRED');
    await reopened.tick();
    expect(execution.tick).not.toHaveBeenCalled();
    const resumed = await reopened.resume(started.id);
    expect(resumed.status).toBe('RUNNING');
    expect(execution.preflight).toHaveBeenLastCalledWith(saved.config, saved.strategySnapshot, expect.objectContaining({ id: started.id, status: 'PAUSED' }));
  });

  it('restored open positions remain unresolved and block new entries until reviewed', async () => {
    const setup = savedSetup();
    const session = sessionFor(setup);
    session.trades = [trade()];
    store.commit({ version: 1, setups: [setup], sessions: [session] });
    const restored = instantiate(new DailyBotStore(storagePath));
    expect(restored.getSession(session.id)).toMatchObject({ status: 'ERROR', trades: [expect.objectContaining({ status: 'OPEN' })] });
    await expect(restored.resume(session.id)).rejects.toThrow('Reconcile');
    await expect(restored.start(setup.id, { operatorConsent: true })).rejects.toThrow('unresolved');
  });

  it('restores the central daily ledger once at startup before timer execution', async () => {
    const setup = savedSetup();
    const stopped = sessionFor(setup);
    stopped.status = 'STOPPED'; stopped.trades = [trade('CLOSED')]; stopped.tradesExecuted = 1;
    store.commit({ version: 1, setups: [setup], sessions: [stopped] });
    execution.restoreDailyLedger.mockClear();
    const restarted = instantiate(new DailyBotStore(storagePath));
    expect(execution.restoreDailyLedger).toHaveBeenCalledOnce();
    expect(execution.restoreDailyLedger).toHaveBeenCalledWith([expect.objectContaining({ id: stopped.id, trades: [expect.objectContaining({ orderId: 'daily-order-1', realizedNetPnl: -300 })] })]);
    await restarted.tick();
    expect(execution.restoreDailyLedger).toHaveBeenCalledOnce();
  });

  it('resumes protection for confirmed paper positions restored by the runtime while entries remain paused', async () => {
    const setup = savedSetup();
    const open = sessionFor(setup);
    open.trades = [trade()];
    store.commit({ version: 1, setups: [setup], sessions: [open] });
    execution.restoreDailyLedger.mockReturnValueOnce(new Set([open.id]));
    const restarted = instantiate(new DailyBotStore(storagePath));
    expect(restarted.getSession(open.id)).toMatchObject({ status: 'PAUSED', lastMessage: expect.stringContaining('positions and risk reservations were restored') });
    await restarted.tick();
    expect(execution.tick).toHaveBeenCalledWith(expect.objectContaining({ id: open.id, status: 'PAUSED' }), expect.any(Function));
    expect(restarted.getSession(open.id).status).toBe('PAUSED');
  });

  it('keeps an unfinished durably checkpointed entry in ERROR across restart', async () => {
    const setup = savedSetup();
    const pending = sessionFor(setup);
    pending.pendingProposalId = 'prop_ambiguous_entry';
    pending.processedSignalKeys = ['signal-in-flight'];
    pending.events.push({ timestamp: new Date().toISOString(), type: 'ENTRY_SUBMITTING', message: 'Entry submitted; acknowledgment pending' });
    store.commit({ version: 1, setups: [setup], sessions: [pending] });
    const restarted = instantiate(new DailyBotStore(storagePath));
    expect(restarted.getSession(pending.id)).toMatchObject({ status: 'ERROR', pendingProposalId: 'prop_ambiguous_entry', lastMessage: expect.stringContaining('broker result was not durably confirmed') });
    await expect(restarted.resume(pending.id)).rejects.toThrow('Reconcile');
    await restarted.tick();
    expect(execution.tick).not.toHaveBeenCalled();
  });

  it('provides a durable checkpoint before runtime order dispatch', async () => {
    const saved = await service.createSetup(configuration());
    const started = await service.start(saved.id, { operatorConsent: true });
    const dispatch = vi.fn();
    execution.tick.mockImplementation(async (session: DailyBotSession, checkpoint: (session: DailyBotSession) => void) => {
      session.pendingProposalId = 'prop_entry_intent';
      session.processedSignalKeys.push('durable-signal');
      checkpoint(session);
      const disk = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      expect(disk.sessions[0]).toMatchObject({ pendingProposalId: 'prop_entry_intent', processedSignalKeys: ['durable-signal'] });
      dispatch();
      session.pendingProposalId = null;
    });
    await service.tick();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(service.getSession(started.id).processedSignalKeys).toEqual(['durable-signal']);
  });

  it('preserves all trading-day losses, counts and consumed signals across repeated sessions', async () => {
    const setup = savedSetup();
    const first = sessionFor(setup);
    first.status = 'STOPPED'; first.trades = [trade('CLOSED')]; first.tradesExecuted = 1; first.processedSignalKeys = ['signal-one'];
    const second = sessionFor(setup);
    second.status = 'COMPLETED'; second.trades = [trade('CLOSED'), { ...trade('CLOSED'), orderId: 'daily-order-2', realizedNetPnl: -150 }]; second.tradesExecuted = 2; second.processedSignalKeys = ['signal-one', 'signal-two'];
    store.commit({ version: 1, setups: [setup], sessions: [first, second] });
    const next = await service.start(setup.id, { operatorConsent: true });
    expect(next.tradesExecuted).toBe(2);
    expect(next.trades).toHaveLength(2);
    expect(next.trades.reduce((sum, recorded) => sum + recorded.realizedNetPnl, 0)).toBe(-450);
    expect(next.processedSignalKeys).toEqual(['signal-one', 'signal-two']);
  });

  it('preflight blocks new sessions when earlier sessions already exhausted the day budget', async () => {
    const setup = savedSetup();
    const completed = sessionFor(setup);
    completed.status = 'STOPPED'; completed.trades = [{ ...trade('CLOSED'), realizedNetPnl: -1000 }]; completed.tradesExecuted = 1;
    store.commit({ version: 1, setups: [setup], sessions: [completed] });
    const preflight = await service.preflight(setup.id);
    expect(preflight.passed).toBe(false);
    expect(preflight.checks.find((check) => check.id === 'persisted-day-budget')?.passed).toBe(false);
    await expect(service.start(setup.id, { operatorConsent: true })).rejects.toThrow('preflight failed');
    expect(store.snapshot().sessions).toHaveLength(1);
  });

  it('runs on a backend timer while paused/stopped positions keep receiving protection ticks', async () => {
    const setup = savedSetup();
    const stopped = sessionFor(setup);
    stopped.status = 'STOPPED'; stopped.trades = [trade()];
    store.commit({ version: 1, setups: [setup], sessions: [stopped] });
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(execution.tick).toHaveBeenCalledOnce();
    expect(execution.tick).toHaveBeenCalledWith(expect.objectContaining({ status: 'STOPPED' }), expect.any(Function));
    expect(service.getSession(stopped.id).lastHeartbeatAt).toBeTruthy();
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(10000);
    expect(execution.tick).toHaveBeenCalledOnce();
  });

  it('prevents overlapping scan ticks', async () => {
    const saved = await service.createSetup(configuration());
    await service.start(saved.id, { operatorConsent: true });
    let finish!: () => void;
    execution.tick.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const firstTick = service.tick();
    await Promise.resolve();
    await service.tick();
    expect(execution.tick).toHaveBeenCalledOnce();
    finish();
    await firstTick;
  });

  it('fails closed on corrupt or unreadable storage instead of losing saved state', () => {
    fs.writeFileSync(storagePath, '{bad json');
    expect(() => new DailyBotStore(storagePath)).toThrow('could not be read or validated');
    fs.writeFileSync(storagePath, JSON.stringify({ version: 99, setups: [], sessions: [] }));
    expect(() => new DailyBotStore(storagePath)).toThrow('could not be read or validated');
  });

  it('surfaces write failure, keeps old durable state, and disables further entry scans', async () => {
    const saved = await service.createSetup(configuration());
    const started = await service.start(saved.id, { operatorConsent: true });
    execution.tick.mockImplementation(async (session: DailyBotSession) => { session.lastMessage = 'tick completed'; });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('storage full'), { code: 'ENOSPC' }); });
    await expect(service.tick()).rejects.toThrow('not durably confirmed');
    expect(service.getSession(started.id)).toMatchObject({ status: 'ERROR', lastMessage: expect.stringContaining('Persistence failed') });
    expect(JSON.parse(fs.readFileSync(storagePath, 'utf8')).sessions[0].lastHeartbeatAt).toBeNull();
    await service.tick();
    expect(execution.tick).toHaveBeenCalledOnce();
    await expect(service.createSetup(configuration())).rejects.toThrow('persistence is unavailable');
    expect(fs.readdirSync(directory)).toEqual(['state.json']);
  });

  it('permits an emergency broker exit attempt even after persistence fails', async () => {
    const saved = await service.createSetup(configuration());
    const started = await service.start(saved.id, { operatorConsent: true });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('storage full'), { code: 'ENOSPC' }); });
    await expect(service.pause(started.id)).rejects.toThrow('not durably confirmed');
    await expect(service.stop(started.id, true)).rejects.toThrow('persistence is unavailable');
    expect(execution.stop).toHaveBeenCalledWith(expect.objectContaining({ id: started.id }), true, expect.any(Function));
  });
});
