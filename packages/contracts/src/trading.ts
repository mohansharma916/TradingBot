import { z } from 'zod';
import { TradeMode } from './enums';

export const AccountFundsSchema = z.object({
  availableCash: z.number().finite().nonnegative(),
  reservedMargin: z.number().finite().nonnegative(),
  totalCapital: z.number().finite().nonnegative(),
  source: z.enum(['LIVE_BROKER', 'PAPER_SIMULATION', 'UNAVAILABLE']),
  status: z.enum(['VERIFIED', 'UNAVAILABLE']),
  verifiedAt: z.string().datetime().nullable(),
});
export type AccountFunds = z.infer<typeof AccountFundsSchema>;

export const TradingModeSnapshotSchema = z.object({
  mode: z.nativeEnum(TradeMode),
  label: z.enum(['TESTING', 'LIVE']),
  liveExecutionEnabled: z.boolean(),
  funds: AccountFundsSchema,
  error: z.string().nullable(),
});
export type TradingModeSnapshot = z.infer<typeof TradingModeSnapshotSchema>;

export const SelectTradingModeSchema = z.object({ mode: z.enum([TradeMode.PAPER, TradeMode.APPROVAL]) });

const JournalTableSummarySchema = z.object({
  rows: z.number().int().nonnegative(),
  oldest: z.string().datetime().nullable(),
  newest: z.string().datetime().nullable(),
});

export const JournalSummarySchema = z.object({
  active: z.boolean(),
  databasePath: z.string().nullable(),
  retentionHours: z.number().int().positive(),
  quoteSampleMs: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  tables: z.record(z.enum(['quotes', 'events', 'logs', 'bot_events', 'trades']), JournalTableSummarySchema),
});
export type JournalSummary = z.infer<typeof JournalSummarySchema>;
