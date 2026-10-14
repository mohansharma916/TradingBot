import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DailyBotSession, JournalSummary, QuoteSnapshot } from '@trading-bot/contracts';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { EnvService } from '../config/env.service';

export const JOURNAL_TABLES = ['quotes', 'events', 'logs', 'bot_events', 'trades'] as const;
export type JournalTable = typeof JOURNAL_TABLES[number];

type Row = Record<string, string | number | null>;

const COLUMNS: Record<JournalTable, string[]> = {
  quotes: ['ts', 'trading_date', 'instrument_key', 'last_price', 'bid', 'ask', 'bid_qty', 'ask_qty', 'volume', 'open_interest', 'provenance', 'is_stale', 'quote_ts'],
  events: ['ts', 'trading_date', 'topic', 'payload'],
  logs: ['ts', 'trading_date', 'level', 'context', 'message'],
  bot_events: ['ts', 'trading_date', 'session_id', 'seq', 'strategy_id', 'strategy_name', 'trading_mode', 'type', 'message'],
  trades: ['ts', 'trading_date', 'order_id', 'session_id', 'strategy_id', 'strategy_name', 'trading_mode', 'symbol', 'instrument_key', 'quantity', 'entry_price', 'exit_price', 'stop_price', 'target_price', 'status', 'realized_net_pnl', 'estimated_charges', 'exit_reason', 'opened_at', 'closed_at', 'data'],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quotes (ts INTEGER NOT NULL, trading_date TEXT NOT NULL, instrument_key TEXT NOT NULL, last_price REAL, bid REAL, ask REAL,
  bid_qty INTEGER, ask_qty INTEGER, volume INTEGER, open_interest INTEGER, provenance TEXT, is_stale INTEGER, quote_ts TEXT);
CREATE INDEX IF NOT EXISTS quotes_ts ON quotes (ts);
CREATE INDEX IF NOT EXISTS quotes_instrument_ts ON quotes (instrument_key, ts);
CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, trading_date TEXT NOT NULL, topic TEXT NOT NULL, payload TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_topic_ts ON events (topic, ts);
CREATE TABLE IF NOT EXISTS logs (ts INTEGER NOT NULL, trading_date TEXT NOT NULL, level TEXT NOT NULL, context TEXT, message TEXT);
CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
CREATE TABLE IF NOT EXISTS bot_events (ts INTEGER NOT NULL, trading_date TEXT NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL, strategy_id TEXT,
  strategy_name TEXT, trading_mode TEXT, type TEXT NOT NULL, message TEXT, PRIMARY KEY (session_id, seq));
CREATE INDEX IF NOT EXISTS bot_events_ts ON bot_events (ts);
CREATE TABLE IF NOT EXISTS trades (ts INTEGER NOT NULL, trading_date TEXT NOT NULL, order_id TEXT PRIMARY KEY, session_id TEXT, strategy_id TEXT,
  strategy_name TEXT, trading_mode TEXT, symbol TEXT, instrument_key TEXT, quantity INTEGER, entry_price REAL, exit_price REAL, stop_price REAL,
  target_price REAL, status TEXT, realized_net_pnl REAL, estimated_charges REAL, exit_reason TEXT, opened_at TEXT, closed_at TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS trades_ts ON trades (ts);
`;

const istDate = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
const UPSERT_TABLES: JournalTable[] = ['bot_events', 'trades'];

/**
 * Rolling SQLite journal of market data, trades, bot decisions and logs for post-session analysis.
 * It is observational only: writes are buffered and every failure disables the journal instead of
 * reaching the trading path. The Daily Bot ledger remains the authoritative trade record.
 */
@Injectable()
export class DataJournalService implements OnModuleInit, OnModuleDestroy {
  public readonly databasePath: string | null;
  public readonly retentionHours: number;
  private readonly quoteSampleMs: number;
  private db: DatabaseSync | null = null;
  private lastError: string | null = null;
  private pending: { table: JournalTable; row: Row }[] = [];
  private readonly lastQuoteAt = new Map<string, number>();
  private readonly botEventSeq = new Map<string, number>();
  private readonly tradeFingerprints = new Map<string, string>();
  private flushTimer?: ReturnType<typeof setInterval>;
  private purgeTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(EnvService) env: EnvService,
    @Optional() @Inject('JOURNAL_DATABASE_PATH') databasePath?: string,
  ) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    this.retentionHours = env.config.JOURNAL_RETENTION_HOURS ?? 48;
    this.quoteSampleMs = env.config.JOURNAL_QUOTE_SAMPLE_MS ?? 5000;
    // Tests journal only when given an explicit path, so suites never write into the real state directory.
    this.databasePath = env.config.JOURNAL_ENABLED === false ? null
      : databasePath ? path.resolve(databasePath)
      : isTest ? null
      : path.resolve(env.config.STATE_DIRECTORY ?? '.data', 'journal.sqlite');
    if (this.databasePath) this.open(this.databasePath);
  }

  private open(file: string): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      // Loaded at runtime so a Node build without node:sqlite only disables the journal.
      const { DatabaseSync: Database } = createRequire(path.join(process.cwd(), 'noop.js'))('node:sqlite') as typeof import('node:sqlite');
      const db = new Database(file);
      db.exec('PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;');
      db.exec(SCHEMA);
      this.db = db;
    } catch (error) {
      this.fail(error);
    }
  }

  public onModuleInit(): void {
    if (!this.db) return;
    this.purgeExpired();
    this.flushTimer = setInterval(() => this.flush(), 1000);
    this.flushTimer.unref?.();
    this.purgeTimer = setInterval(() => this.purgeExpired(), 15 * 60_000);
    this.purgeTimer.unref?.();
  }

  public onModuleDestroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.flush();
    try { this.db?.close(); } catch { /* Closing is best effort. */ }
    this.db = null;
  }

  public isActive(): boolean { return this.db !== null; }

  private fail(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.pending = [];
    try { this.db?.close(); } catch { /* Already failing. */ }
    this.db = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    // Console directly: the Nest logger is itself journaled.
    console.error(`[DataJournal] Disabled after error: ${this.lastError}. Trading is unaffected.`);
  }

  private enqueue(table: JournalTable, row: Row): void {
    if (!this.db) return;
    this.pending.push({ table, row });
    if (this.pending.length >= 5000) this.flush();
  }

  public flush(): void {
    if (!this.db || this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      this.db.exec('BEGIN');
      const statements = new Map<JournalTable, ReturnType<DatabaseSync['prepare']>>();
      for (const { table, row } of batch) {
        let statement = statements.get(table);
        if (!statement) {
          const columns = COLUMNS[table];
          statement = this.db.prepare(`INSERT OR ${UPSERT_TABLES.includes(table) ? 'REPLACE' : 'ABORT'} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
          statements.set(table, statement);
        }
        statement.run(...COLUMNS[table].map((column) => row[column] ?? null));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db?.exec('ROLLBACK'); } catch { /* Report the original failure. */ }
      this.fail(error);
    }
  }

  /** Every WebSocket broadcast: quotes go to the sampled quotes table, everything else to events. */
  public recordBroadcast(topic: string, payload: unknown, now = Date.now()): void {
    if (!this.db) return;
    if (topic === 'quotes.snapshot' || topic === 'quote') {
      for (const quote of (Array.isArray(payload) ? payload : [payload]) as QuoteSnapshot[]) this.recordQuote(quote, now);
      return;
    }
    let serialized: string;
    try { serialized = JSON.stringify(payload ?? null); } catch { serialized = '"[unserializable]"'; }
    this.enqueue('events', { ts: now, trading_date: istDate(now), topic, payload: serialized });
  }

  public recordQuote(quote: QuoteSnapshot, now = Date.now()): void {
    if (!this.db || !quote?.instrumentKey) return;
    const previous = this.lastQuoteAt.get(quote.instrumentKey);
    if (previous !== undefined && now - previous < this.quoteSampleMs) return;
    this.lastQuoteAt.set(quote.instrumentKey, now);
    this.enqueue('quotes', {
      ts: now, trading_date: istDate(now), instrument_key: quote.instrumentKey, last_price: quote.lastPrice, bid: quote.bidPrice, ask: quote.askPrice,
      bid_qty: quote.bidQty, ask_qty: quote.askQty, volume: quote.volume, open_interest: quote.openInterest,
      provenance: quote.provenance ?? null, is_stale: quote.isStale ? 1 : 0, quote_ts: quote.timestamp ?? null,
    });
  }

  public recordLog(level: string, context: string, message: string, now = Date.now()): void {
    this.enqueue('logs', { ts: now, trading_date: istDate(now), level, context, message });
  }

  /** Called after each durable Daily Bot commit; only new events and changed trades are written. */
  public recordSessions(sessions: DailyBotSession[]): void {
    if (!this.db) return;
    const cutoff = Date.now() - this.retentionHours * 3_600_000;
    for (const session of sessions) {
      const strategy = { strategy_id: session.strategySnapshot.id, strategy_name: session.strategySnapshot.name, trading_mode: session.config.tradingMode };
      const seen = this.botEventSeq.get(session.id) ?? 0;
      session.events.slice(seen).forEach((event, offset) => {
        const ts = Date.parse(event.timestamp);
        if (ts >= cutoff) this.enqueue('bot_events', { ts, trading_date: istDate(ts), session_id: session.id, seq: seen + offset, ...strategy, type: event.type, message: event.message });
      });
      this.botEventSeq.set(session.id, session.events.length);
      for (const trade of session.trades) {
        const data = JSON.stringify(trade);
        if (this.tradeFingerprints.get(trade.orderId) === data) continue;
        this.tradeFingerprints.set(trade.orderId, data);
        const ts = Date.parse(trade.closedAt ?? trade.openedAt ?? session.startedAt);
        if (ts < cutoff) continue;
        this.enqueue('trades', {
          ts, trading_date: session.config.tradingDate, order_id: trade.orderId, session_id: session.id, ...strategy, symbol: trade.symbol,
          instrument_key: trade.instrumentKey, quantity: trade.quantity, entry_price: trade.entryPrice, exit_price: trade.exitPrice ?? null,
          stop_price: trade.stopPrice, target_price: trade.targetPrice ?? null, status: trade.status, realized_net_pnl: trade.realizedNetPnl,
          estimated_charges: trade.estimatedCharges, exit_reason: trade.exitReason ?? null, opened_at: trade.openedAt ?? null, closed_at: trade.closedAt ?? null, data,
        });
      }
    }
  }

  /** Deletes rows older than the retention window and returns the space to the filesystem. */
  public purgeExpired(now = Date.now()): Record<JournalTable, number> {
    const deleted = Object.fromEntries(JOURNAL_TABLES.map((table) => [table, 0])) as Record<JournalTable, number>;
    if (!this.db) return deleted;
    this.flush();
    if (!this.db) return deleted;
    try {
      const cutoff = now - this.retentionHours * 3_600_000;
      for (const table of JOURNAL_TABLES) {
        deleted[table] = Number(this.db!.prepare(`DELETE FROM ${table} WHERE ts < ?`).run(cutoff).changes);
      }
      this.db!.exec('PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (error) {
      this.fail(error);
    }
    return deleted;
  }

  public summary(): JournalSummary {
    this.flush();
    const tables = Object.fromEntries(JOURNAL_TABLES.map((table) => {
      if (!this.db) return [table, { rows: 0, oldest: null, newest: null }];
      const row = this.db.prepare(`SELECT COUNT(*) AS rows, MIN(ts) AS oldest, MAX(ts) AS newest FROM ${table}`).get() as { rows: number; oldest: number | null; newest: number | null };
      return [table, { rows: Number(row.rows), oldest: row.oldest ? new Date(Number(row.oldest)).toISOString() : null, newest: row.newest ? new Date(Number(row.newest)).toISOString() : null }];
    })) as JournalSummary['tables'];
    let sizeBytes = 0;
    for (const suffix of ['', '-wal']) {
      try { if (this.databasePath) sizeBytes += fs.statSync(this.databasePath + suffix).size; } catch { /* File not created yet. */ }
    }
    return { active: this.isActive(), databasePath: this.databasePath, retentionHours: this.retentionHours, quoteSampleMs: this.quoteSampleMs, sizeBytes, lastError: this.lastError, tables };
  }

  public query(table: JournalTable, filters: { from?: number; to?: number; limit?: number; match?: string }): Row[] {
    if (!this.db) return [];
    this.flush();
    const matchColumn: Partial<Record<JournalTable, string>> = { quotes: 'instrument_key', events: 'topic', logs: 'level', bot_events: 'type', trades: 'strategy_id' };
    const clauses = ['ts >= ?', 'ts <= ?'];
    const params: (string | number)[] = [filters.from ?? 0, filters.to ?? Number.MAX_SAFE_INTEGER];
    if (filters.match && matchColumn[table]) { clauses.push(`${matchColumn[table]} = ?`); params.push(filters.match); }
    const limit = Math.max(1, Math.min(filters.limit ?? 1000, 20_000));
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY ts ASC LIMIT ${limit}`).all(...params) as Row[];
  }
}
