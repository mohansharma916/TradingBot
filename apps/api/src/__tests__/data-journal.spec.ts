// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AllowedOptionType, DailyBotSession, DailyBotSessionSchema, MoneynessType, StrategyStatus, TradeMode } from '@trading-bot/contracts';
import { DataJournalService } from '../journal/data-journal.service';
import { JournalController } from '../journal/journal.controller';
import { DailyBotStore } from '../daily-bot/daily-bot.store';

const env = (overrides: Record<string, unknown> = {}) => ({ config: { JOURNAL_ENABLED: true, JOURNAL_RETENTION_HOURS: 48, JOURNAL_QUOTE_SAMPLE_MS: 5000, ...overrides } }) as any;
const quote = (instrumentKey: string, lastPrice: number) => ({
  instrumentKey, lastPrice, bidPrice: lastPrice - 0.5, askPrice: lastPrice + 0.5, bidQty: 75, askQty: 150, volume: 1000, openInterest: 5000,
  timestamp: new Date().toISOString(), isStale: false, netChange: 0, netChangePct: 0, provenance: 'LIVE' as const,
});

function session(events: number, closedAt: string): DailyBotSession {
  const strategyId = randomUUID();
  return DailyBotSessionSchema.parse({
    id: randomUUID(), setupId: randomUUID(), status: 'RUNNING', startedAt: closedAt, stoppedAt: null, lastHeartbeatAt: null, lastMessage: '',
    config: { name: 'Day', tradingDate: closedAt.slice(0, 10), dailyCapitalBudget: 10000, dailyMaxLossAllIn: 1000, perTradeMaxLossAllIn: 500, maxCapitalPerTrade: 5000, strategyId },
    strategySnapshot: {
      id: strategyId, name: 'Trend', version: 1, status: StrategyStatus.PAPER_ACTIVE, tradeMode: TradeMode.PAPER, market: 'NSE_FO', underlying: 'NIFTY',
      allowedInstruments: [AllowedOptionType.LONG_CALL], timeframe: '5m', session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      entry: { emaPeriod: 20, rsiPeriod: 14, rsiThreshold: 55, maxBidAskSpreadPct: 1, minVolume: 1000 },
      selection: { expiry: 'NEAREST_ELIGIBLE', moneyness: MoneynessType.ATM, minVolume: 1000 },
      risk: { maxCapitalInr: 10000, maxAllInTradeLossInr: 500, maxAllInDailyLossInr: 1500, maxOpenPositions: 1, maxTradesPerDay: 3, targetNetProfitInr: 300, maxRoundTripCostBudgetInr: 60 },
      exit: { stopBasis: 'OPTION_PREMIUM', marketCutoff: '15:10' }, maxCapitalInr: 10000, maxAllInTradeLossInr: 500, maxAllInDailyLossInr: 1500,
      targetNetProfitInr: 300, maxRoundTripCostBudgetInr: 60, maxOpenPositions: 1, requiresApproval: true,
    },
    tradesExecuted: 1, pendingProposalId: null,
    events: Array.from({ length: events }, (_, index) => ({ timestamp: closedAt, type: index === 0 ? 'STARTED' : 'NO_ENTRY_SIGNAL', message: `event ${index}` })),
    trades: [{ proposalId: 'p1', orderId: 'ord_paper_1', instrumentKey: 'NSE_FO|1', symbol: 'NIFTY25000CE', quantity: 75, entryPrice: 100, currentPrice: 110,
      stopPrice: 92, peakNetProfit: 0, protectedNetProfit: 0, trailingActive: false, status: 'CLOSED', realizedNetPnl: 650, estimatedCharges: 50, openedAt: closedAt, closedAt, exitReason: 'TARGET' }],
  });
}

describe('Rolling data journal', () => {
  let directory: string;
  let journal: DataJournalService;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
    journal = new DataJournalService(env(), path.join(directory, 'journal.sqlite'));
  });
  afterEach(() => {
    journal.onModuleDestroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('stays off in tests unless a path is given, and when disabled by configuration', () => {
    expect(new DataJournalService(env()).isActive()).toBe(false);
    expect(new DataJournalService(env({ JOURNAL_ENABLED: false }), path.join(directory, 'off.sqlite')).isActive()).toBe(false);
    expect(journal.isActive()).toBe(true);
  });

  it('samples option quotes per instrument and stores other broadcasts as events', () => {
    const start = Date.now();
    journal.recordBroadcast('quotes.snapshot', [quote('NSE_FO|CE', 100), quote('NSE_FO|PE', 90)], start);
    journal.recordBroadcast('quotes.snapshot', [quote('NSE_FO|CE', 101)], start + 1000); // inside sample window
    journal.recordBroadcast('quote', quote('NSE_FO|CE', 102), start + 5000);
    journal.recordBroadcast('order.changed', { orderId: 'o1', status: 'FILLED' }, start);
    const quotes = journal.query('quotes', { match: 'NSE_FO|CE' });
    expect(quotes.map((row) => row.last_price)).toEqual([100, 102]);
    expect(quotes[0]).toMatchObject({ bid: 99.5, ask: 100.5, open_interest: 5000, provenance: 'LIVE' });
    expect(journal.query('quotes', {})).toHaveLength(3);
    expect(JSON.parse(String(journal.query('events', { match: 'order.changed' })[0]!.payload))).toEqual({ orderId: 'o1', status: 'FILLED' });
  });

  it('journals Daily Bot decisions and trades from durable commits without duplicates', () => {
    const store = new DailyBotStore(path.join(directory, 'daily-bot.json'), undefined, journal);
    const now = new Date().toISOString();
    const recorded = session(2, now);
    const setup = { id: recorded.setupId, createdAt: now, clonedFromId: null, config: recorded.config, strategySnapshot: recorded.strategySnapshot };
    store.commit({ version: 1, setups: [setup], sessions: [recorded] });
    recorded.events.push({ timestamp: now, type: 'ENTRY_FILLED', message: 'filled' });
    store.commit({ version: 1, setups: [setup], sessions: [recorded] });
    store.commit({ version: 1, setups: [setup], sessions: [recorded] });
    expect(journal.query('bot_events', {}).map((row) => row.type)).toEqual(['STARTED', 'NO_ENTRY_SIGNAL', 'ENTRY_FILLED']);
    expect(journal.query('trades', {})).toEqual([expect.objectContaining({ order_id: 'ord_paper_1', strategy_name: 'Trend', realized_net_pnl: 650, exit_reason: 'TARGET', trading_mode: TradeMode.PAPER })]);
  });

  it('purges rows older than the retention window and keeps recent ones', () => {
    const now = Date.now();
    journal.recordLog('log', 'Test', 'old', now - 49 * 3_600_000);
    journal.recordLog('warn', 'Test', 'recent', now - 47 * 3_600_000);
    journal.recordBroadcast('alert.created', { title: 'old' }, now - 50 * 3_600_000);
    expect(journal.purgeExpired(now)).toMatchObject({ logs: 1, events: 1 });
    expect(journal.query('logs', {}).map((row) => row.message)).toEqual(['recent']);
    expect(journal.summary()).toMatchObject({ active: true, retentionHours: 48, tables: { logs: { rows: 1 }, events: { rows: 0 } } });
  });

  it('serves filtered rows and CSV through the controller', () => {
    journal.recordLog('warn', 'Risk', 'Daily loss, "near" cap');
    const controller = new JournalController(journal);
    expect(controller.table('logs', undefined, undefined, undefined, 'warn')).toHaveLength(1);
    expect(controller.csv('logs')).toContain('"Daily loss, ""near"" cap"');
    expect(() => controller.table('sqlite_master')).toThrow('Unknown journal table');
    expect(() => controller.table('logs', 'yesterday')).toThrow('Invalid time');
  });

  it('disables itself on storage failure instead of throwing into the trading path', () => {
    (journal as any).db.close();
    journal.recordLog('log', 'Test', 'after close');
    expect(() => journal.flush()).not.toThrow();
    expect(journal.summary()).toMatchObject({ active: false, lastError: expect.any(String) });
    expect(() => journal.recordBroadcast('order.changed', {})).not.toThrow();
  });
});
