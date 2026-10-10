import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { WorkerService } from '../worker.service.ts';
import { RiskState, TradeMode } from '@trading-bot/contracts';

describe('WorkerService', () => {
  it('initializes passive observer and starts DISARMED by default', async () => {
    const worker = new WorkerService();
    await worker.onModuleInit();

    const status = worker.getStatus();
    expect(status.isLeader).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.riskState).toBe(RiskState.DISARMED);
    expect(status.tradeMode).toBe(TradeMode.PAPER);

    await worker.onModuleDestroy();
  });
});
