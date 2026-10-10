import { z } from 'zod';
import { TradeMode } from './enums';
import { StrategyConfigSchema, TradeProposalSchema } from './schemas';

export const DailyBotTradingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date');

const sessionTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const amountSchema = z.number().finite().positive();

export const DailyBotConfigSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tradingDate: DailyBotTradingDateSchema,
  tradingMode: z.nativeEnum(TradeMode).default(TradeMode.PAPER),
  dailyCapitalBudget: amountSchema.max(10000),
  dailyMaxLossAllIn: amountSchema.max(1500),
  perTradeMaxLossAllIn: amountSchema.max(500),
  maxCapitalPerTrade: amountSchema.max(10000),
  maximumTradesPerDay: z.number().int().min(1).max(20).default(3),
  maximumConcurrentPositions: z.literal(1).default(1),
  minNetProfitToActivateTrailing: amountSchema.default(300),
  desiredNetProfitLock: z.number().finite().nonnegative().default(100),
  trailingAlgorithm: z.enum(['STEP_LOCK', 'FIXED_PERCENT']).default('STEP_LOCK'),
  trailingStepProfit: amountSchema.default(100),
  trailingStepLock: amountSchema.default(50),
  trailingPercent: amountSchema.max(30).default(5),
  maxRoundTripCharges: amountSchema.default(60),
  dailyNetProfitObjective: amountSchema.optional(),
  entryStartTime: sessionTimeSchema.default('09:25'),
  lastEntryTime: sessionTimeSchema.default('14:45'),
  mandatoryExitTime: sessionTimeSchema.default('15:10'),
  strategyId: z.string().uuid(),
}).superRefine((config, context) => {
  const issue = (field: keyof typeof config, message: string) => context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [field],
    message,
  });
  if (config.perTradeMaxLossAllIn > config.dailyMaxLossAllIn) {
    issue('perTradeMaxLossAllIn', 'Per-trade loss must not exceed the daily loss budget');
  }
  if (config.dailyMaxLossAllIn > config.dailyCapitalBudget) {
    issue('dailyMaxLossAllIn', 'Daily loss must not exceed the daily capital budget');
  }
  if (config.maxCapitalPerTrade > config.dailyCapitalBudget) {
    issue('maxCapitalPerTrade', 'Per-trade capital must not exceed the daily capital budget');
  }
  if (config.desiredNetProfitLock >= config.minNetProfitToActivateTrailing) {
    issue('desiredNetProfitLock', 'Profit lock must be below the trailing activation amount');
  }
  for (const field of ['entryStartTime', 'lastEntryTime', 'mandatoryExitTime'] as const) {
    if (config[field] < '09:15' || config[field] > '15:30') {
      issue(field, 'Trading times must be within the 09:15–15:30 IST market session');
    }
  }
  if (config.entryStartTime >= config.lastEntryTime) {
    issue('lastEntryTime', 'Last entry must be after the entry start time');
  }
  if (config.lastEntryTime >= config.mandatoryExitTime) {
    issue('mandatoryExitTime', 'Mandatory exit must be after the last entry time');
  }
});

export type DailyBotConfig = z.infer<typeof DailyBotConfigSchema>;
export type DailyBotConfigInput = z.input<typeof DailyBotConfigSchema>;

export const DailyBotSetupSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  clonedFromId: z.string().uuid().nullable(),
  config: DailyBotConfigSchema,
  strategySnapshot: StrategyConfigSchema,
});
export type DailyBotSetup = z.infer<typeof DailyBotSetupSchema>;

export const DailyBotTradeSchema = z.object({
  proposalId: z.string().min(1),
  orderId: z.string().min(1),
  instrumentKey: z.string().min(1),
  symbol: z.string().min(1),
  quantity: z.number().int().positive(),
  entryPrice: amountSchema,
  currentPrice: z.number().finite().nonnegative(),
  stopPrice: amountSchema,
  peakNetProfit: z.number().finite(),
  protectedNetProfit: z.number().finite(),
  trailingActive: z.boolean(),
  status: z.enum(['OPEN', 'EXIT_PENDING', 'CLOSED', 'ERROR']),
  realizedNetPnl: z.number().finite(),
  estimatedCharges: z.number().finite().nonnegative(),
  reservationId: z.string().min(1).optional(),
  signalKey: z.string().min(1).optional(),
  initialStopPrice: amountSchema.optional(),
  tickSize: amountSchema.optional(),
  entryActualCharges: z.number().finite().nonnegative().optional(),
  grossPnl: z.number().finite().optional(),
  netPnl: z.number().finite().optional(),
  exitOrderId: z.string().min(1).nullable().optional(),
  exitPrice: z.number().finite().nonnegative().nullable().optional(),
  openedAt: z.string().datetime().optional(),
  closedAt: z.string().datetime().nullable().optional(),
  exitReason: z.string().nullable().optional(),
});
export type DailyBotTrade = z.infer<typeof DailyBotTradeSchema>;

export const DailyBotEventSchema = z.object({
  timestamp: z.string().datetime(),
  type: z.string().min(1),
  message: z.string().min(1),
});
export type DailyBotEvent = z.infer<typeof DailyBotEventSchema>;

export const DailyBotSessionSchema = z.object({
  id: z.string().uuid(),
  setupId: z.string().uuid(),
  status: z.enum(['RUNNING', 'PAUSED', 'STOPPING', 'STOPPED', 'COMPLETED', 'ERROR']),
  config: DailyBotConfigSchema,
  strategySnapshot: StrategyConfigSchema,
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  lastMessage: z.string(),
  tradesExecuted: z.number().int().nonnegative(),
  pendingProposalId: z.string().min(1).nullable(),
  pendingProposal: TradeProposalSchema.extend({ id: z.string().min(1) }).nullable().default(null),
  processedSignalKeys: z.array(z.string().min(1)).default([]),
  lastScanBar: z.string().nullable().default(null),
  trades: z.array(DailyBotTradeSchema),
  events: z.array(DailyBotEventSchema),
});
export type DailyBotSession = z.infer<typeof DailyBotSessionSchema>;

export const DailyBotPreflightSchema = z.object({
  passed: z.boolean(),
  evaluatedAt: z.string().datetime(),
  checks: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    passed: z.boolean(),
    message: z.string(),
  })),
});
export type DailyBotPreflight = z.infer<typeof DailyBotPreflightSchema>;

export const DailyBotTodaySchema = z.object({
  tradingDate: DailyBotTradingDateSchema,
  setups: z.array(DailyBotSetupSchema),
  todaySetup: DailyBotSetupSchema.nullable(),
  previousSetup: DailyBotSetupSchema.nullable(),
  activeSession: DailyBotSessionSchema.nullable(),
  session: DailyBotSessionSchema.nullable(),
  strategies: z.array(StrategyConfigSchema),
  availableFunds: z.number().finite().nonnegative(),
  supportedModes: z.array(z.nativeEnum(TradeMode)),
});
export type DailyBotToday = z.infer<typeof DailyBotTodaySchema>;

export const DailyBotStartRequestSchema = z.object({
  operatorConsent: z.boolean(),
  confirmationCode: z.string().trim().min(1).optional(),
});
export type DailyBotStartRequest = z.infer<typeof DailyBotStartRequestSchema>;

export const DailyBotCloneRequestSchema = z.object({ tradingDate: DailyBotTradingDateSchema });
export type DailyBotCloneRequest = z.infer<typeof DailyBotCloneRequestSchema>;

export const DailyBotControlActionSchema = z.enum(['pause', 'resume', 'stop', 'emergency-stop', 'approve-entry']);
export type DailyBotControlAction = z.infer<typeof DailyBotControlActionSchema>;
