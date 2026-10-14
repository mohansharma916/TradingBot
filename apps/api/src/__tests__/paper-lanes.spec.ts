// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PaperLanesService } from '../daily-bot/paper-lanes.service';

describe('Isolated parallel paper lanes', () => {
  let directory: string;
  let services: PaperLanesService[];
  const env = { config: { STATE_DIRECTORY: '.data', MAX_ACCOUNT_CAPITAL_INR: 10000, MAX_ALL_IN_TRADE_RISK_INR: 500, MAX_DAILY_DRAWDOWN_INR: 1500, LIVE_EXECUTION_ENABLED: true } };
  const strategies = { getAllStrategies: () => [], getStrategy: () => undefined, createStrategy: () => undefined };
  const gateway = { broadcast: () => undefined };
  const catalog = { getInstrument: () => undefined, getUnderlyingInstruments: () => [] };
  const feed = { getQuote: () => undefined };
  const make = () => {
    const service = new PaperLanesService(env as any, strategies as any, {} as any, {} as any, feed as any, catalog as any, gateway as any, undefined, directory);
    services.push(service);
    return service;
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-lanes-test-'));
    services = [];
  });
  afterEach(() => {
    for (const service of services) service.onModuleDestroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('gives each strategy its own virtual account, risk ledger and state directory', () => {
    const lanes = make();
    lanes.onModuleInit();
    const [a, b] = [randomUUID(), randomUUID()];
    const laneA = lanes.getLane(a);
    const laneB = lanes.getLane(b);
    expect(lanes.getLane(a)).toBe(laneA);
    expect(laneA.directory).toBe(path.join(directory, a));
    expect(laneA.reservations).not.toBe(laneB.reservations);

    laneA.reservations.arm(60);
    laneA.reservations.acquireReservation({ proposalId: 'p1', signalKey: 's1', instrumentKey: 'NSE_FO|1', capitalRequired: 4000, allInRisk: 300 });
    expect(laneA.reservations.getAvailableCash()).toBe(6000);
    expect(laneB.reservations.getAvailableCash()).toBe(10000);
    expect(laneB.reservations.isArmed()).toBe(false);
    expect(fs.readdirSync(laneA.directory)).toContain('risk-PAPER.json');
    expect(lanes.snapshot().map((row) => ({ id: row.strategyId, funds: row.availableFunds, mode: row.tradingMode })))
      .toEqual(expect.arrayContaining([{ id: a, funds: 6000, mode: 'PAPER' }, { id: b, funds: 10000, mode: 'PAPER' }]));
    // Lanes only ever offer Testing, even when the deployment enables Live.
    expect(laneA.dailyBot.getToday().activeSession).toBeNull();
  });

  it('reloads existing lanes after a restart so open virtual positions keep their ledgers', () => {
    const first = make();
    const id = randomUUID();
    const lane = first.getLane(id);
    lane.reservations.arm(60);
    lane.reservations.acquireReservation({ proposalId: 'p1', signalKey: 's1', instrumentKey: 'NSE_FO|1', capitalRequired: 2500, allInRisk: 300 });
    first.onModuleDestroy();
    fs.mkdirSync(path.join(directory, 'not-a-lane'));

    const restarted = make();
    restarted.onModuleInit();
    expect(restarted.getLanes().map((item) => item.strategyId)).toEqual([id]);
    expect(restarted.getLane(id).reservations.getAvailableCash()).toBe(7500);
    expect(() => restarted.getLane('../escape')).toThrow('keyed by strategy id');
  });
});
