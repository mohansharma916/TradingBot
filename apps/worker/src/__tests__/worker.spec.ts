import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { WorkerService } from '../worker.service.ts';
import { RiskState, TradeMode } from '@trading-bot/contracts';

describe('WorkerService', () => {
  it('initializes single-leader and starts DISARMED by default', async () => {
    const worker = new WorkerService();
    await worker.onModuleInit();

    const status = worker.getStatus();
    expect(status.isLeader).toBe(true);
    expect(status.riskState).toBe(RiskState.DISARMED);
    expect(status.tradeMode).toBe(TradeMode.PAPER);

    await worker.onModuleDestroy();
  });
});
