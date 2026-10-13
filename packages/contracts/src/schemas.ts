import { z } from 'zod';
import {
  AgentType,
  AgentToolName,
  AgentTaskStatus,
  AllowedOptionType,
  MoneynessType,
  BrokerHealthStatus,
  InstrumentType,
  OrderSide,
  OrderStatus,
  OrderType,
  ProductType,
  ProposalStatus,
  RiskState,
  StrategyStatus,
  TradeMode,
  ExitProtectionStatus,
  AlertSeverity,
  IndicatorType,
  ComparisonOperator,
  LogicalOperator,
  TrailingProfitMode,
  StrikeSelection,
  ExpirySelection,
  TradeDirection,
} from './enums';

// Environment Schema
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WORKER_PORT: z.coerce.number().default(4001),
  CORS_ORIGIN: z.string().default('http://localhost:8081,http://localhost:3000'),
  JWT_SECRET: z.string().min(16).default('super_secret_dev_key_change_in_production_min_32_chars'),
  OWNER_USERNAME: z.string().min(1).default('owner'),
  OWNER_PASSWORD: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(8).max(512).optional(),
  ),
  API_HOST: z.string().default('127.0.0.1'),
  STATE_DIRECTORY: z.string().min(1).default('.data'),
  UPSTOX_ALGO_NAME: z.string().optional(),
  // Safe boolean parser: only 'true'/'1'/true → true. Prevents the Zod z.coerce.boolean() trap
  // where the STRING "false" evaluates to truthy and inadvertently enables live execution/MFA.
  MFA_ENABLED: z.preprocess(
    (v) => v === 'true' || v === '1' || v === true,
    z.boolean()
  ).default(false),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/trading_bot'),
  SYSTEM_MODE: z.nativeEnum(TradeMode).default(TradeMode.PAPER),
  DEFAULT_RISK_STATE: z.nativeEnum(RiskState).default(RiskState.DISARMED),
  MAX_ACCOUNT_CAPITAL_INR: z.coerce.number().default(10000),
  MAX_ALL_IN_TRADE_RISK_INR: z.coerce.number().default(500),
  MAX_DAILY_DRAWDOWN_INR: z.coerce.number().default(1500),
  TARGET_DAILY_PROFIT_INR: z.coerce.number().default(4000),
  UPSTOX_API_KEY: z.string().optional().default('mock_key'),
  UPSTOX_API_SECRET: z.string().optional().default('mock_secret'),
  UPSTOX_REDIRECT_URI: z.string().url().default('http://localhost:4000/api/v1/broker/upstox/callback'),
  UPSTOX_EGRESS_IP: z.string().default('127.0.0.1'),
  UPSTOX_BASE_URL: z.string().url().default('https://api.upstox.com/v3'),
  UPSTOX_HFT_URL: z.string().url().default('https://api-hft.upstox.com/v3'),
  TOKEN_ENCRYPTION_KEY: z.string().min(16).default('32_byte_aes_gcm_token_encryption_key_default'),
  // Safe boolean parser: only 'true'/'1'/true → true. CRITICAL: prevents "false" string from
  // enabling live execution. A misconfigured .env with LIVE_EXECUTION_ENABLED=false (string)
  // previously resolved to true and could open the live-trading gate unintentionally.
  LIVE_EXECUTION_ENABLED: z.preprocess(
    (v) => v === 'true' || v === '1' || v === true,
    z.boolean()
  ).default(false),
  DAILY_BOT_STORAGE_PATH: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

// Instrument Schema
export const InstrumentSchema = z.object({
  instrumentKey: z.string(), // e.g. "NSE_FO|52175"
  exchange: z.string(), // "NSE_FO"
  symbol: z.string(), // "NIFTY26OCT25000CE"
  underlying: z.string(), // "NIFTY"
  instrumentType: z.nativeEnum(InstrumentType),
  strikePrice: z.number().optional(),
  lotSize: z.number().int().positive(),
  tickSize: z.number().positive(),
  expiry: z.string().datetime().optional(),
});

export type Instrument = z.infer<typeof InstrumentSchema>;

// Market Depth Schema (5-level bid/ask)
export const MarketDepthLevelSchema = z.object({
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative().optional(),
});

export const MarketDepthSchema = z.object({
  bids: z.array(MarketDepthLevelSchema).max(5),
  asks: z.array(MarketDepthLevelSchema).max(5),
});

export type MarketDepth = z.infer<typeof MarketDepthSchema>;

// Market Quote Schema
export const QuoteSnapshotSchema = z.object({
  instrumentKey: z.string(),
  lastPrice: z.number().nonnegative(),
  bidPrice: z.number().nonnegative(),
  askPrice: z.number().nonnegative(),
  bidQty: z.number().int().nonnegative(),
  askQty: z.number().int().nonnegative(),
  volume: z.number().int().nonnegative(),
  openInterest: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  isStale: z.boolean().default(false),
  netChange: z.number().optional().default(0),
  netChangePct: z.number().optional().default(0),
  openPrice: z.number().nonnegative().optional(),
  highPrice: z.number().nonnegative().optional(),
  lowPrice: z.number().nonnegative().optional(),
  closePrice: z.number().nonnegative().optional(),
  depth: MarketDepthSchema.optional(),
  provenance: z.enum(['LIVE', 'DELAYED', 'SIMULATED', 'UNAVAILABLE']).optional(),
  receivedAt: z.string().datetime().optional(),
  depthKnown: z.boolean().optional(),
});

export type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;

// Market Calendar Schema
export const MarketCalendarSchema = z.object({
  session: z.string(), // MarketSession enum value
  isOpen: z.boolean(),
  currentTimeIst: z.string(),
  sessionStartTime: z.string(),
  sessionEndTime: z.string(),
  timeUntilOpenMs: z.number().nonnegative(),
  timeUntilCloseMs: z.number().nonnegative(),
  isHoliday: z.boolean(),
  holidayName: z.string().optional(),
});

export type MarketCalendar = z.infer<typeof MarketCalendarSchema>;

// Option Chain Item & Result Schemas
export const OptionChainStrikeSchema = z.object({
  strikePrice: z.number().positive(),
  call: z.object({
    instrumentKey: z.string(),
    symbol: z.string(),
    lastPrice: z.number().nonnegative(),
    bidPrice: z.number().nonnegative(),
    askPrice: z.number().nonnegative(),
    volume: z.number().int().nonnegative(),
    openInterest: z.number().int().nonnegative(),
    netChangePct: z.number(),
    isStale: z.boolean().default(false),
    provenance: z.enum(['LIVE', 'DELAYED', 'SIMULATED', 'UNAVAILABLE']).optional(),
    depthKnown: z.boolean().optional(),
  }).optional(),
  put: z.object({
    instrumentKey: z.string(),
    symbol: z.string(),
    lastPrice: z.number().nonnegative(),
    bidPrice: z.number().nonnegative(),
    askPrice: z.number().nonnegative(),
    volume: z.number().int().nonnegative(),
    openInterest: z.number().int().nonnegative(),
    netChangePct: z.number(),
    isStale: z.boolean().default(false),
    provenance: z.enum(['LIVE', 'DELAYED', 'SIMULATED', 'UNAVAILABLE']).optional(),
    depthKnown: z.boolean().optional(),
  }).optional(),
});

export const OptionChainResultSchema = z.object({
  underlying: z.string(),
  spotPrice: z.number().nonnegative(),
  expiryDate: z.string(),
  availableExpiries: z.array(z.string()),
  lotSize: z.number().int().nonnegative(),
  strikes: z.array(OptionChainStrikeSchema),
  timestamp: z.string().datetime(),
  provenance: z.enum(['LIVE', 'DELAYED', 'SIMULATED', 'UNAVAILABLE']).optional(),
});

export type OptionChainResult = z.infer<typeof OptionChainResultSchema>;

// Instrument Search Query Schema
export const SearchInstrumentsQuerySchema = z.object({
  query: z.string().min(1),
  underlying: z.string().optional(),
  instrumentType: z.nativeEnum(InstrumentType).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SearchInstrumentsQuery = z.infer<typeof SearchInstrumentsQuerySchema>;

// Strategy Sub-Schemas
export const StrategySessionSchema = z.object({
  start: z.string().default('09:25'),
  lastEntry: z.string().default('14:45'),
  timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
});
export type StrategySession = z.infer<typeof StrategySessionSchema>;

export const StrategyEntryRuleSchema = z.object({
  emaPeriod: z.number().int().positive().default(20),
  rsiPeriod: z.number().int().positive().default(14),
  rsiThreshold: z.number().min(0).max(100).default(55),
  maxBidAskSpreadPct: z.number().positive().default(1.0),
  minVolume: z.number().int().nonnegative().default(1000),
});
export type StrategyEntryRule = z.infer<typeof StrategyEntryRuleSchema>;

export const StrategySelectionSchema = z.object({
  expiry: z.enum(['NEAREST_ELIGIBLE', 'MONTHLY']).default('NEAREST_ELIGIBLE'),
  moneyness: z.nativeEnum(MoneynessType).default(MoneynessType.ATM),
  minVolume: z.number().int().nonnegative().default(1000),
});
export type StrategySelection = z.infer<typeof StrategySelectionSchema>;

export const StrategyRiskRulesSchema = z.object({
  maxCapitalInr: z.number().positive().max(10000).default(10000),
  maxAllInTradeLossInr: z.number().positive().max(500).default(200),
  maxAllInDailyLossInr: z.number().positive().max(1500).default(600),
  maxOpenPositions: z.number().int().positive().default(1),
  maxTradesPerDay: z.number().int().positive().default(3),
  targetNetProfitInr: z.number().positive().default(300),
  maxRoundTripCostBudgetInr: z.number().positive().default(60),
});
export type StrategyRiskRules = z.infer<typeof StrategyRiskRulesSchema>;

export const StrategyExitRulesSchema = z.object({
  stopBasis: z.enum(['OPTION_PREMIUM', 'UNDERLYING_LEVEL']).default('OPTION_PREMIUM'),
  stopLossPoints: z.number().positive().optional(),
  targetPoints: z.number().positive().optional(),
  marketCutoff: z.string().default('15:10'),
});
export type StrategyExitRules = z.infer<typeof StrategyExitRulesSchema>;

// Strategy Lab AST Interfaces & Schemas
export interface StrategyIndicatorConfig {
  id: string;
  type: IndicatorType;
  period?: number;
  source?: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
  timeframe?: string;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  stdDevMultiplier?: number;
  overbought?: number;
  oversold?: number;
  lookback?: number;
  sessionReset?: boolean;
}

export const StrategyIndicatorConfigSchema: z.ZodType<StrategyIndicatorConfig, z.ZodTypeDef, any> = z.object({
  id: z.string().min(1),
  type: z.nativeEnum(IndicatorType),
  period: z.number().int().positive().optional(),
  source: z.enum(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4']).optional().default('close'),
  timeframe: z.string().optional(),
  fastPeriod: z.number().int().positive().optional(),
  slowPeriod: z.number().int().positive().optional(),
  signalPeriod: z.number().int().positive().optional(),
  stdDevMultiplier: z.number().positive().optional(),
  overbought: z.number().optional(),
  oversold: z.number().optional(),
  lookback: z.number().int().positive().optional(),
  sessionReset: z.boolean().optional(),
});

export interface RuleOperand {
  type: 'INDICATOR' | 'CANDLE_FIELD' | 'NUMBER' | 'RANGE';
  indicatorId?: string;
  field?: string;
  offset?: number;
  value?: number;
  min?: number;
  max?: number;
  multiplier?: number;
}

export const RuleOperandSchema: z.ZodType<RuleOperand, z.ZodTypeDef, any> = z.object({
  type: z.enum(['INDICATOR', 'CANDLE_FIELD', 'NUMBER', 'RANGE']),
  indicatorId: z.string().optional(),
  field: z.string().optional(),
  offset: z.number().int().min(0).optional().default(0),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  multiplier: z.number().optional(),
});

export interface ConditionRule {
  id: string;
  left: RuleOperand;
  comparison: ComparisonOperator;
  right?: RuleOperand;
  tolerance?: number;
  enabled?: boolean;
  description?: string;
}

export const ConditionRuleSchema: z.ZodType<ConditionRule, z.ZodTypeDef, any> = z.object({
  id: z.string().min(1),
  left: RuleOperandSchema,
  comparison: z.nativeEnum(ComparisonOperator),
  right: RuleOperandSchema.optional(),
  tolerance: z.number().optional(),
  enabled: z.boolean().optional().default(true),
  description: z.string().optional(),
});

export type RuleGroup = {
  id: string;
  operator?: LogicalOperator;
  enabled?: boolean;
  conditions: Array<ConditionRule | RuleGroup>;
  description?: string;
};

export const RuleGroupSchema: z.ZodType<RuleGroup, z.ZodTypeDef, any> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    operator: z.nativeEnum(LogicalOperator).optional().default(LogicalOperator.AND),
    enabled: z.boolean().optional().default(true),
    conditions: z.array(z.union([ConditionRuleSchema, RuleGroupSchema])).optional().default([]),
    description: z.string().optional(),
  })
);

export interface EntryRulesConfig {
  candleCloseConfirmation?: boolean;
  confirmingCandles?: number;
  minSignalStrength?: number;
  signalExpiryMinutes?: number;
  cooldownBars?: number;
  allowReentry?: boolean;
}

export const EntryRulesConfigSchema: z.ZodType<EntryRulesConfig, z.ZodTypeDef, any> = z.object({
  candleCloseConfirmation: z.boolean().optional().default(true),
  confirmingCandles: z.number().int().positive().optional().default(1),
  minSignalStrength: z.number().min(0).max(100).optional(),
  signalExpiryMinutes: z.number().int().positive().optional().default(15),
  cooldownBars: z.number().int().min(0).optional().default(1),
  allowReentry: z.boolean().optional().default(false),
});

export interface ContractSelectionConfig {
  instrumentType?: 'OPTIONS' | 'FUTURES';
  optionSide?: 'LONG_CE' | 'LONG_PE' | 'BOTH';
  underlying?: string;
  expiry?: ExpirySelection;
  strikeSelection?: StrikeSelection;
  strikeDistance?: number;
  minVolume?: number;
  minOpenInterest?: number;
  maxBidAskSpreadPct?: number;
  minPremium?: number;
  maxPremium?: number;
  minDaysToExpiry?: number;
  maxRequiredMarginInr?: number;
}

export const ContractSelectionConfigSchema: z.ZodType<ContractSelectionConfig, z.ZodTypeDef, any> = z.object({
  instrumentType: z.enum(['OPTIONS', 'FUTURES']).optional().default('OPTIONS'),
  optionSide: z.enum(['LONG_CE', 'LONG_PE', 'BOTH']).optional().default('BOTH'),
  underlying: z.string().optional().default('NIFTY'),
  expiry: z.nativeEnum(ExpirySelection).optional().default(ExpirySelection.NEAREST_ELIGIBLE),
  strikeSelection: z.nativeEnum(StrikeSelection).optional().default(StrikeSelection.ATM),
  strikeDistance: z.number().int().min(0).optional().default(0),
  minVolume: z.number().min(0).optional().default(1000),
  minOpenInterest: z.number().min(0).optional().default(5000),
  maxBidAskSpreadPct: z.number().positive().optional().default(1.5),
  minPremium: z.number().min(0).optional().default(20),
  maxPremium: z.number().positive().optional().default(600),
  minDaysToExpiry: z.number().min(0).optional().default(0),
  maxRequiredMarginInr: z.number().positive().optional().default(10000),
});

export interface ExitRulesConfig {
  stopLossBasis?: 'OPTION_PREMIUM' | 'UNDERLYING_POINTS' | 'PERCENTAGE' | 'ATR_MULTIPLE';
  stopLossValue?: number;
  targetProfitBasis?: 'OPTION_PREMIUM' | 'UNDERLYING_POINTS' | 'PERCENTAGE' | 'RISK_REWARD';
  targetProfitValue?: number;
  exitOnOppositeSignal?: boolean;
  exitOnIndicatorReversal?: boolean;
  marketCutoffTime?: string;
  maxHoldingBars?: number;
}

export const ExitRulesConfigSchema: z.ZodType<ExitRulesConfig, z.ZodTypeDef, any> = z.object({
  stopLossBasis: z.enum(['OPTION_PREMIUM', 'UNDERLYING_POINTS', 'PERCENTAGE', 'ATR_MULTIPLE']).optional().default('OPTION_PREMIUM'),
  stopLossValue: z.number().positive().optional().default(8),
  targetProfitBasis: z.enum(['OPTION_PREMIUM', 'UNDERLYING_POINTS', 'PERCENTAGE', 'RISK_REWARD']).optional().default('OPTION_PREMIUM'),
  targetProfitValue: z.number().positive().optional().default(12),
  exitOnOppositeSignal: z.boolean().optional().default(true),
  exitOnIndicatorReversal: z.boolean().optional().default(false),
  marketCutoffTime: z.string().optional().default('15:10'),
  maxHoldingBars: z.number().int().positive().optional(),
});

export interface TrailingProfitConfig {
  enabled?: boolean;
  mode?: TrailingProfitMode;
  activationProfitInr?: number;
  trailingGapInr?: number;
  profitLockInr?: number;
  adjustmentStepInr?: number;
  adjustmentFrequencyBars?: number;
  atrPeriod?: number;
  atrMultiplier?: number;
}

export const TrailingProfitConfigSchema: z.ZodType<TrailingProfitConfig, z.ZodTypeDef, any> = z.object({
  enabled: z.boolean().optional().default(false),
  mode: z.nativeEnum(TrailingProfitMode).optional().default(TrailingProfitMode.FIXED_STEP),
  activationProfitInr: z.number().positive().optional().default(150),
  trailingGapInr: z.number().positive().optional().default(50),
  profitLockInr: z.number().positive().optional(),
  adjustmentStepInr: z.number().positive().optional().default(50),
  adjustmentFrequencyBars: z.number().int().positive().optional().default(1),
  atrPeriod: z.number().int().positive().optional(),
  atrMultiplier: z.number().positive().optional(),
});

export interface StrategyAstConfig {
  templateId?: string;
  direction?: TradeDirection;
  category?: string;
  indicators?: StrategyIndicatorConfig[];
  bullishEntry?: RuleGroup;
  bearishEntry?: RuleGroup;
  entryRules?: EntryRulesConfig;
  contractSelection?: ContractSelectionConfig;
  exitRules?: ExitRulesConfig;
  trailingProfit?: TrailingProfitConfig;
}

export const StrategyAstConfigSchema: z.ZodType<StrategyAstConfig, z.ZodTypeDef, any> = z.object({
  templateId: z.string().optional(),
  direction: z.nativeEnum(TradeDirection).optional().default(TradeDirection.BOTH),
  category: z.string().optional().default('CUSTOM'),
  indicators: z.array(StrategyIndicatorConfigSchema).optional().default([]),
  bullishEntry: RuleGroupSchema.optional(),
  bearishEntry: RuleGroupSchema.optional(),
  entryRules: EntryRulesConfigSchema.optional().default({}),
  contractSelection: ContractSelectionConfigSchema.optional().default({}),
  exitRules: ExitRulesConfigSchema.optional().default({}),
  trailingProfit: TrailingProfitConfigSchema.optional().default({}),
});

// Strategy Config Schema
export const StrategyConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  templateId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  version: z.number().int().positive().default(1),
  versionHash: z.string().optional(),
  status: z.nativeEnum(StrategyStatus).default(StrategyStatus.DRAFT),
  tradeMode: z.nativeEnum(TradeMode).default(TradeMode.PAPER),
  market: z.string().default('NSE_FO'),
  underlying: z.string().default('NIFTY'), // "NIFTY", "BANKNIFTY"
  allowedInstruments: z.array(z.nativeEnum(AllowedOptionType)).default([AllowedOptionType.LONG_CALL]),
  timeframe: z.string().default('5m'), // "1m", "5m", "15m"
  session: StrategySessionSchema.default({}),
  entry: StrategyEntryRuleSchema.default({}),
  selection: StrategySelectionSchema.default({}),
  risk: StrategyRiskRulesSchema.default({}),
  exit: StrategyExitRulesSchema.default({}),
  astConfig: StrategyAstConfigSchema.optional(),
  isArchived: z.boolean().optional(),
  maxCapitalInr: z.number().positive().max(10000).default(10000), // Account hard cap
  maxAllInTradeLossInr: z.number().positive().max(500).default(200),
  maxAllInDailyLossInr: z.number().positive().max(1500).default(600),
  targetNetProfitInr: z.number().positive().default(300),
  maxRoundTripCostBudgetInr: z.number().positive().default(60),
  maxOpenPositions: z.number().int().positive().default(1),
  requiresApproval: z.boolean().default(true),
});

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

// Backtest Schemas
export const BacktestTradeRecordSchema = z.object({
  id: z.string(),
  entryTime: z.string(),
  exitTime: z.string(),
  durationMinutes: z.number().optional(),
  symbol: z.string(),
  side: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  quantity: z.number(),
  grossPnl: z.number(),
  charges: z.number(),
  netPnl: z.number(),
  exitReason: z.string(),
  initialStopPrice: z.number().optional(),
  trailingStopPrice: z.number().optional(),
});
export type BacktestTradeRecord = z.infer<typeof BacktestTradeRecordSchema>;

export const BacktestRequestSchema = z.object({
  days: z.number().int().min(1).max(90).default(14),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1d']).default('5m'),
  initialCapital: z.number().positive().default(10000),
  underlying: z.enum(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']).default('NIFTY'),
  useTrailingStop: z.boolean().optional(),
  trailingActivationProfitInr: z.number().nonnegative().optional(),
  trailingStepInr: z.number().nonnegative().optional(),
  // No defaults: an omitted limit must fall back to the strategy's saved limit, never replace it.
  maxTradesPerDay: z.number().int().min(1).max(50).optional(),
  maxTradeLossInr: z.number().positive().optional(),
  maxDailyLossInr: z.number().positive().optional(),
  strategy: StrategyConfigSchema.optional(),
});
export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

export const BacktestResultSchema = z.object({
  strategyId: z.string(),
  strategyName: z.string(),
  version: z.number(),
  periodDays: z.number(),
  timeframe: z.string().default('5m'),
  fromDate: z.string(),
  toDate: z.string(),
  dataSource: z.string().default('UNAVAILABLE'),
  modelAssumptions: z.array(z.string()).optional(),
  runId: z.string().optional(),
  dataFingerprint: z.string().optional(),
  effectiveLotSize: z.number().optional(),
  effectiveTickSize: z.number().optional(),
  effectiveStrategyConfig: z.record(z.any()).optional(),
  equityCurve: z.array(z.object({ timestamp: z.string(), equity: z.number() })).optional(),
  initialCapital: z.number(),
  finalCapital: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  winRatePct: z.number(),
  grossPnl: z.number(),
  totalCharges: z.number(),
  netPnl: z.number(),
  maxDrawdown: z.number(),
  maxDrawdownPct: z.number(),
  /** Null when there are no losing trades (the ratio is undefined), never an invented value. */
  profitFactor: z.number().nullable(),
  trades: z.array(BacktestTradeRecordSchema),
  error: z.string().optional(),
});
export type BacktestResult = z.infer<typeof BacktestResultSchema>;

// Agent Read-Only Tool Schemas
export const ToolScanUniverseInputSchema = z.object({
  underlying: z.string().default('NIFTY'),
  minVolume: z.number().int().nonnegative().default(1000),
  maxSpreadPct: z.number().positive().default(1.0),
  expiry: z.string().optional(),
});
export type ToolScanUniverseInput = z.infer<typeof ToolScanUniverseInputSchema>;

export const ScannedInstrumentCandidateSchema = z.object({
  instrumentKey: z.string(),
  symbol: z.string(),
  strikePrice: z.number().positive(),
  instrumentType: z.nativeEnum(InstrumentType),
  lastPrice: z.number().nonnegative(),
  bidPrice: z.number().nonnegative(),
  askPrice: z.number().nonnegative(),
  spreadPct: z.number().nonnegative(),
  volume: z.number().int().nonnegative(),
  openInterest: z.number().int().nonnegative(),
  lotSize: z.number().int().positive(),
  liquidityScore: z.number().min(0).max(100),
});
export type ScannedInstrumentCandidate = z.infer<typeof ScannedInstrumentCandidateSchema>;

export const ToolScanUniverseOutputSchema = z.object({
  underlying: z.string(),
  spotPrice: z.number().nonnegative(),
  candidates: z.array(ScannedInstrumentCandidateSchema),
  timestamp: z.string().datetime(),
});
export type ToolScanUniverseOutput = z.infer<typeof ToolScanUniverseOutputSchema>;

export const ToolCalculateIndicatorsInputSchema = z.object({
  instrumentKey: z.string(),
  timeframe: z.string().default('5m'),
  emaPeriod: z.number().int().positive().default(20),
  rsiPeriod: z.number().int().positive().default(14),
  candleCount: z.number().int().positive().default(50),
});
export type ToolCalculateIndicatorsInput = z.infer<typeof ToolCalculateIndicatorsInputSchema>;

export const ToolCalculateIndicatorsOutputSchema = z.object({
  instrumentKey: z.string(),
  timeframe: z.string(),
  totalClosedCandles: z.number().int().nonnegative(),
  isWarmedUp: z.boolean(),
  missingWarmupCandles: z.number().int().nonnegative().default(0),
  lastClosedCandleTime: z.string().optional(),
  ema: z.number().optional(),
  previousEma: z.number().optional(),
  rsi: z.number().optional(),
  previousRsi: z.number().optional(),
  vwap: z.number().optional(),
  closePrice: z.number().optional(),
});
export type ToolCalculateIndicatorsOutput = z.infer<typeof ToolCalculateIndicatorsOutputSchema>;

export const ToolEvaluateStrategyInputSchema = z.object({
  strategyId: z.string().uuid(),
  instrumentKey: z.string(),
  symbol: z.string(),
  spotPrice: z.number().positive(),
  underlyingEma: z.number(),
  previousUnderlyingEma: z.number(),
  underlyingClose: z.number(),
  previousUnderlyingClose: z.number(),
  rsi: z.number(),
  bidPrice: z.number().nonnegative(),
  askPrice: z.number().nonnegative(),
  volume: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type ToolEvaluateStrategyInput = z.infer<typeof ToolEvaluateStrategyInputSchema>;

export const ToolEvaluateStrategyOutputSchema = z.object({
  passed: z.boolean(),
  reasons: z.array(z.string()),
  signal: z.enum(['BUY_CALL', 'BUY_PUT', 'NONE']),
  confidence: z.number().min(0).max(1),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});
export type ToolEvaluateStrategyOutput = z.infer<typeof ToolEvaluateStrategyOutputSchema>;

export const AgentToolInvocationSchema = z.object({
  tool: z.nativeEnum(AgentToolName),
  timestamp: z.string().datetime(),
  input: z.record(z.string(), z.any()),
  output: z.record(z.string(), z.any()),
});
export type AgentToolInvocation = z.infer<typeof AgentToolInvocationSchema>;

export const AgentTaskSchema = z.object({
  id: z.string().min(1),
  agentType: z.nativeEnum(AgentType),
  status: z.nativeEnum(AgentTaskStatus),
  objective: z.string().min(1),
  toolsInvoked: z.array(AgentToolInvocationSchema).default([]),
  resultSummary: z.string().default(''),
  proposalGenerated: z.any().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

// Trade Proposal Schema
export const TradeProposalSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().uuid(),
  strategyVersion: z.number().int().positive(),
  versionHash: z.string().optional(),
  proposingAgent: z.nativeEnum(AgentType),
  instrumentKey: z.string(),
  symbol: z.string(),
  side: z.nativeEnum(OrderSide),
  product: z.nativeEnum(ProductType),
  suggestedEntryPrice: z.number().positive(),
  suggestedStopPrice: z.number().positive(),
  suggestedTargetPrice: z.number().positive(),
  lotSize: z.number().int().positive(),
  quantity: z.number().int().positive(),
  estimatedCapitalRequired: z.number().positive(),
  estimatedRoundTripCosts: z.number().positive(),
  allInMaxLoss: z.number().positive(),
  estimatedNetProfit: z.number().positive(),
  evidence: z.object({
    indicators: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  status: z.nativeEnum(ProposalStatus).default(ProposalStatus.PENDING),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type TradeProposal = z.infer<typeof TradeProposalSchema>;

// Risk Decision Schema
export const RiskDecisionSchema = z.object({
  proposalId: z.string().uuid(),
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  reservedRiskAmount: z.number().nonnegative(),
  reservedCapitalAmount: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});

export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

// Execution Intent Schema (Single unresolved intent per signal bar)
export const ExecutionIntentSchema = z.object({
  id: z.string().uuid(),
  signalKey: z.string(), // Unique key e.g. "STRAT_1:NIFTY:5m:2026-10-10T09:30:00Z"
  proposalId: z.string().uuid(),
  accountId: z.string().uuid(),
  mode: z.nativeEnum(TradeMode),
  approvedBy: z.string().nullable(),
  status: z.nativeEnum(OrderStatus),
  createdAt: z.string().datetime(),
});

export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

// Broker Order Schema
export const BrokerOrderSchema = z.object({
  id: z.string().min(1),
  intentId: z.string().min(1),
  brokerOrderId: z.string().nullable(),
  tag: z.string().max(20),
  instrumentKey: z.string(),
  side: z.nativeEnum(OrderSide),
  orderType: z.nativeEnum(OrderType),
  product: z.nativeEnum(ProductType),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
  triggerPrice: z.number().nonnegative().optional(),
  status: z.nativeEnum(OrderStatus),
  filledQuantity: z.number().int().nonnegative().default(0),
  averageFillPrice: z.number().nonnegative().default(0),
  exchangeOrderId: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BrokerOrder = z.infer<typeof BrokerOrderSchema>;

// Position Schema
export const PositionSchema = z.object({
  id: z.string().min(1),
  instrumentKey: z.string(),
  symbol: z.string(),
  netQuantity: z.number().int(),
  buyQuantity: z.number().int().nonnegative(),
  sellQuantity: z.number().int().nonnegative(),
  buyAvgPrice: z.number().nonnegative(),
  sellAvgPrice: z.number().nonnegative(),
  lastPrice: z.number().nonnegative(),
  unrealizedPnl: z.number(),
  realizedPnl: z.number(),
  stopLossPrice: z.number().positive().nullable().optional(),
  targetPrice: z.number().positive().nullable().optional(),
  lastVerifiedAt: z.string().datetime(),
});

export type Position = z.infer<typeof PositionSchema>;

// Risk Status / Policy Schema
export const RiskStatusSchema = z.object({
  mode: z.nativeEnum(TradeMode),
  state: z.nativeEnum(RiskState),
  totalCapital: z.number().nonnegative(),
  availableCash: z.number().nonnegative(),
  reservedCapital: z.number().nonnegative(),
  maxAllInTradeLoss: z.number().positive(),
  dailyLossCap: z.number().positive(),
  realizedNetDailyPnl: z.number(),
  unrealizedDailyPnl: z.number(),
  remainingDailyRiskBudget: z.number(),
  openPositionsCount: z.number().int().nonnegative(),
  maxOpenPositions: z.number().int().positive(),
  dailyTargetProfit: z.number().positive(),
  armedUntil: z.string().datetime().nullable(),
  killSwitchActive: z.boolean(),
  egressIpVerified: z.boolean(),
  fundsSource: z.enum(['LIVE_BROKER', 'PAPER_SIMULATION', 'UNAVAILABLE']).optional(),
  fundsVerifiedAt: z.string().datetime().nullable().optional(),
});

export type RiskStatus = z.infer<typeof RiskStatusSchema>;

// Broker Health Schema
export const BrokerHealthSchema = z.object({
  broker: z.literal('UPSTOX'),
  status: z.nativeEnum(BrokerHealthStatus),
  isAuthenticated: z.boolean(),
  tokenExpiresAt: z.string().datetime().nullable(),
  registeredEgressIp: z.string(),
  currentEgressIp: z.string(),
  ipMatches: z.boolean(),
  marketFeedConnected: z.boolean(),
  feedLatencyMs: z.number().nonnegative(),
  lastSeenAt: z.string().datetime(),
});

export type BrokerHealth = z.infer<typeof BrokerHealthSchema>;

// Daily Report Summary Schema
export const DailyReportSchema = z.object({
  tradingDay: z.string(), // "2026-10-10"
  mode: z.nativeEnum(TradeMode),
  realizedGrossPnl: z.number(),
  estimatedCharges: z.number().nonnegative(),
  actualCharges: z.number().nonnegative(),
  realizedNetPnl: z.number(),
  unrealizedPnl: z.number(),
  totalTrades: z.number().int().nonnegative(),
  winningTrades: z.number().int().nonnegative(),
  losingTrades: z.number().int().nonnegative(),
  maxDrawdown: z.number().nonnegative(),
  capitalDeployed: z.number().nonnegative(),
  chargesSource: z.enum(['ESTIMATED', 'SIMULATED', 'BROKER_CONFIRMED']).optional(),
  dataSource: z.enum(['LIVE_BROKER', 'PAPER_SIMULATION']).optional(),
  unmatchedSellQuantity: z.number().nonnegative().optional(),
});

export type DailyReport = z.infer<typeof DailyReportSchema>;

// Charge Breakdown Schema
export const ChargeBreakdownSchema = z.object({
  brokerage: z.number(),
  stt: z.number(),
  exchangeCharges: z.number(),
  sebiCharges: z.number(),
  stampDuty: z.number(),
  gst: z.number(),
  totalRoundTripCharges: z.number(),
});

export type ChargeBreakdown = z.infer<typeof ChargeBreakdownSchema>;

// Order Fill Event Schema
export const OrderFillEventSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  instrumentKey: z.string(),
  side: z.nativeEnum(OrderSide),
  fillQty: z.number().int().positive(),
  fillPrice: z.number().positive(),
  charges: ChargeBreakdownSchema,
  timestamp: z.string().datetime(),
  estimatedCharges: z.number().nonnegative(),
  actualCharges: z.number().nonnegative(),
  chargesSource: z.enum(['ESTIMATED', 'SIMULATED', 'BROKER_CONFIRMED']).optional(),
});

export type OrderFillEvent = z.infer<typeof OrderFillEventSchema>;

// Upstox OAuth & Session Schemas
export const UpstoxOAuthConnectResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string().min(16),
  expiresInSeconds: z.number().int().positive(),
});

export type UpstoxOAuthConnectResponse = z.infer<typeof UpstoxOAuthConnectResponseSchema>;

export const UpstoxOAuthCallbackDtoSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export type UpstoxOAuthCallbackDto = z.infer<typeof UpstoxOAuthCallbackDtoSchema>;

export const UpstoxSessionStatusSchema = z.object({
  isConnected: z.boolean(),
  isExpired: z.boolean(),
  tokenExpiresAt: z.string().datetime().nullable(),
  secondsRemaining: z.number().int().nonnegative(),
  egressIpVerified: z.boolean(),
  registeredEgressIp: z.string(),
  currentEgressIp: z.string(),
  rateLimitRemaining: z.number().int().nonnegative(),
  lastReconciledAt: z.string().datetime().nullable(),
});

export type UpstoxSessionStatus = z.infer<typeof UpstoxSessionStatusSchema>;

// Reconciliation Schemas
export const ReconciliationDiscrepancySchema = z.object({
  type: z.enum([
    'POSITION_MISMATCH',
    'ORDER_MISMATCH',
    'PRICE_MISMATCH',
    'PHANTOM_BROKER_POSITION',
    'MISSING_LOCAL_RECORD',
  ]),
  instrumentKey: z.string(),
  brokerValue: z.any(),
  localValue: z.any(),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO']),
  actionTaken: z.string(),
});

export type ReconciliationDiscrepancy = z.infer<typeof ReconciliationDiscrepancySchema>;

export const ReconciliationReportSchema = z.object({
  timestamp: z.string().datetime(),
  status: z.enum(['CLEAN', 'MISMATCH_DETECTED']),
  brokerPositionsCount: z.number().int().nonnegative(),
  localPositionsCount: z.number().int().nonnegative(),
  brokerOrdersCount: z.number().int().nonnegative(),
  localOrdersCount: z.number().int().nonnegative(),
  discrepancies: z.array(ReconciliationDiscrepancySchema),
  executionFrozen: z.boolean(),
});

export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;

// Phase 5: GTT Protective Exit Schemas
export const GTTRuleTypeSchema = z.enum(['ENTRY', 'TARGET', 'STOPLOSS']);
export type GTTRuleType = z.infer<typeof GTTRuleTypeSchema>;

export const GTTRuleSchema = z.object({
  type: GTTRuleTypeSchema,
  triggerPrice: z.number().positive(),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
});

export type GTTRule = z.infer<typeof GTTRuleSchema>;

export const GTTOrderPayloadSchema = z.object({
  instrumentKey: z.string(),
  type: z.literal('MULTIPLE'),
  product: z.nativeEnum(ProductType),
  rules: z.array(GTTRuleSchema).min(1),
});

export type GTTOrderPayload = z.infer<typeof GTTOrderPayloadSchema>;

export const ProtectionResultSchema = z.object({
  success: z.boolean(),
  gttOrderId: z.string().optional(),
  protectionStatus: z.nativeEnum(ExitProtectionStatus),
  stopLossPrice: z.number().positive(),
  targetPrice: z.number().positive(),
  confirmedQty: z.number().int().positive(),
  message: z.string(),
});

export type ProtectionResult = z.infer<typeof ProtectionResultSchema>;

// Phase 5: Go-Live Checklist Schemas
export const GoLiveChecklistItemSchema = z.object({
  id: z.string(),
  category: z.enum([
    'REGULATORY',
    'INFRASTRUCTURE',
    'RISK_CAPS',
    'BROKER_OAUTH',
    'MARKET_DATA',
    'PROTECTION_MECHANISM',
    'CONSENT',
  ]),
  title: z.string(),
  description: z.string(),
  passed: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
  evidence: z.string().optional(),
});

export type GoLiveChecklistItem = z.infer<typeof GoLiveChecklistItemSchema>;

export const GoLiveChecklistSchema = z.object({
  allPassed: z.boolean(),
  items: z.array(GoLiveChecklistItemSchema),
  signedOffBy: z.string().nullable(),
  signedOffAt: z.string().datetime().nullable(),
  liveExecutionPermitted: z.boolean(),
});

export type GoLiveChecklist = z.infer<typeof GoLiveChecklistSchema>;

// Phase 5: Supervised Live Execution Schemas
export const SupervisedExecutionRequestSchema = z.object({
  proposalId: z.string().uuid(),
  revalidateFreshness: z.boolean().default(true),
  simulateTimeout: z.boolean().optional(),
  simulateProtectionFailure: z.boolean().optional(),
  simulateUncoveredPosition: z.boolean().optional(),
  simulateExitLimitUnfilled: z.boolean().optional(),
});

export type SupervisedExecutionRequest = z.infer<typeof SupervisedExecutionRequestSchema>;

export const SupervisedExecutionResultSchema = z.object({
  orderId: z.string(),
  intentId: z.string(),
  orderStatus: z.nativeEnum(OrderStatus),
  protectionStatus: z.nativeEnum(ExitProtectionStatus),
  filledQuantity: z.number().int().nonnegative(),
  averagePrice: z.number().nonnegative(),
  gttOrderId: z.string().optional(),
  message: z.string(),
});

export type SupervisedExecutionResult = z.infer<typeof SupervisedExecutionResultSchema>;

// Phase 6: Operational Resilience & Risk Center Schemas
export const FlattenExitDetailSchema = z.object({
  orderId: z.string(),
  instrumentKey: z.string(),
  symbol: z.string(),
  quantity: z.number().int().positive(),
  exitPrice: z.number().nonnegative(),
  realizedPnl: z.number(),
  charges: z.number().nonnegative(),
  status: z.nativeEnum(OrderStatus),
});

export type FlattenExitDetail = z.infer<typeof FlattenExitDetailSchema>;

export const FlattenPositionsResultSchema = z.object({
  success: z.boolean(),
  positionsClosed: z.number().int().nonnegative(),
  exitOrders: z.array(FlattenExitDetailSchema),
  totalRealizedNetPnl: z.number(),
  totalActualCharges: z.number().nonnegative(),
  message: z.string(),
  disclaimer: z.string().default('Exits submitted as market orders; confirmed broker fill events finalize closed ledger state.'),
});

export type FlattenPositionsResult = z.infer<typeof FlattenPositionsResultSchema>;

// Phase 6: System Alerts & Notifications Schemas
export const SystemAlertSchema = z.object({
  id: z.string().uuid(),
  severity: z.nativeEnum(AlertSeverity),
  category: z.enum([
    'RISK_GATE',
    'FEED_STALE',
    'RECONCILIATION',
    'KILL_SWITCH',
    'ORDER_EXECUTION',
    'PROTECTION_FAILURE',
    'SYSTEM',
  ]),
  title: z.string(),
  message: z.string(),
  acknowledged: z.boolean(),
  timestamp: z.string().datetime(),
});

export type SystemAlert = z.infer<typeof SystemAlertSchema>;

// Phase 6: Live Health Diagnostics Schema
export const DiagnosticsReportSchema = z.object({
  uptimeSeconds: z.number().nonnegative(),
  memoryUsageMb: z.number().nonnegative(),
  systemMode: z.nativeEnum(TradeMode),
  marketFeed: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nonnegative(),
    staleTicksCount: z.number().int().nonnegative(),
    lastTickAt: z.string().datetime().nullable(),
  }),
  brokerConnection: z.object({
    authenticated: z.boolean(),
    rateLimiterTokensRemaining: z.number().nonnegative().nullable(),
    egressIpMatch: z.boolean().nullable(),
    registeredIp: z.string(),
    tokenExpiresInSeconds: z.number().nullable(),
  }),
  riskStatus: z.object({
    killSwitchActive: z.boolean(),
    riskState: z.nativeEnum(RiskState),
    availableCash: z.number().nonnegative(),
    reservedCapital: z.number().nonnegative(),
    dailyDrawdownBudgetRemaining: z.number().nonnegative(),
    openPositionsCount: z.number().int().nonnegative(),
  }),
  reconciliation: z.object({
    activeScheduler: z.boolean(),
    lastReconciliationAt: z.string().datetime().nullable(),
    discrepancyCount: z.number().int().nonnegative(),
  }),
  timestamp: z.string().datetime(),
});

export type DiagnosticsReport = z.infer<typeof DiagnosticsReportSchema>;

// Phase 6: Reconciliation Schedule Status Schema
export const ReconciliationScheduleStatusSchema = z.object({
  schedulerActive: z.boolean(),
  intervalSeconds: z.number().int().positive(),
  lastRunAt: z.string().datetime().nullable(),
  totalRuns: z.number().int().nonnegative(),
  lastDiscrepanciesFound: z.number().int().nonnegative(),
});

export type ReconciliationScheduleStatus = z.infer<typeof ReconciliationScheduleStatusSchema>;

// Phase 7: Bounded Autonomous Mode Schemas
export const AutonomousReadinessItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum([
    'REGULATORY',
    'PAPER_PROOF',
    'GO_LIVE',
    'RECONCILIATION',
    'BROKER_AUTH',
    'FEED_HEALTH',
  ]),
  passed: z.boolean(),
  details: z.string(),
  verifiedAt: z.string().datetime(),
});

export type AutonomousReadinessItem = z.infer<typeof AutonomousReadinessItemSchema>;

export const AutonomousReadinessReportSchema = z.object({
  isEligibleForAuto: z.boolean(),
  items: z.array(AutonomousReadinessItemSchema),
  evaluatedAt: z.string().datetime(),
  summary: z.string(),
});

export type AutonomousReadinessReport = z.infer<typeof AutonomousReadinessReportSchema>;

export const AutonomousArmRequestSchema = z.object({
  strategyId: z.string().uuid(),
  windowMinutes: z.number().int().min(5).max(120).default(30),
  maxSessionTrades: z.number().int().min(1).max(5).default(2),
  confirmationCode: z.string().min(1),
  operatorConsent: z.boolean().refine((val) => val === true, {
    message: 'Explicit operator affirmative consent required for autonomous execution.',
  }),
});

export type AutonomousArmRequest = z.infer<typeof AutonomousArmRequestSchema>;

export const AutonomousSessionStatusSchema = z.object({
  isArmed: z.boolean(),
  strategyId: z.string().uuid().nullable(),
  strategyName: z.string().nullable(),
  strategyVersion: z.number().int().positive().nullable(),
  versionHash: z.string().nullable(),
  armedAt: z.string().datetime().nullable(),
  armedUntil: z.string().datetime().nullable(),
  remainingMinutes: z.number().nonnegative(),
  tradesExecutedInSession: z.number().int().nonnegative(),
  maxSessionTrades: z.number().int().positive(),
  lastDisarmReason: z.string().nullable(),
  systemMode: z.nativeEnum(TradeMode),
});

export type AutonomousSessionStatus = z.infer<typeof AutonomousSessionStatusSchema>;

export const AutonomousExecutionLogSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  strategyId: z.string().uuid(),
  versionHash: z.string(),
  action: z.enum([
    'AUTO_TRIGGERED',
    'PRE_TRADE_VALIDATED',
    'ORDER_DISPATCHED',
    'AUTO_DISARMED',
    'AUTO_BLOCKED',
  ]),
  details: z.string(),
  riskChecksPassed: z.boolean(),
});

export type AutonomousExecutionLog = z.infer<typeof AutonomousExecutionLogSchema>;

// Price Action Directional Momentum Strategy Schemas
export const PriceActionMomentumConfigSchema = z.object({
  candleCount: z.number().int().min(4).max(20).default(6),
  minimumEfficiency: z.number().min(0.1).max(1.0).default(0.60),
  minimumStructureConfirmations: z.number().int().min(1).max(10).default(3),
  useMultiTimeframeConfirmation: z.boolean().default(false),
  mtfLookbackCandles: z.number().int().min(2).max(10).default(3),
  underlying: z.enum(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']).default('NIFTY'),
  moneyness: z.enum(['ATM', 'ITM', 'OTM']).default('ATM'),
  strikeOffset: z.number().int().min(0).max(5).default(0),
  stopLossType: z.enum(['STRUCTURE_BASED', 'FIXED_POINTS', 'PERCENTAGE']).default('STRUCTURE_BASED'),
  stopLossValue: z.number().positive().default(25),
  targetProfitType: z.enum(['RISK_REWARD', 'FIXED_POINTS', 'PERCENTAGE']).default('RISK_REWARD'),
  riskRewardRatio: z.number().positive().default(2.0),
  targetPoints: z.number().positive().default(50),
  trailingStopEnabled: z.boolean().default(true),
  trailingActivationProfitInr: z.number().positive().default(150),
  trailingStepInr: z.number().positive().default(50),
  maxTradesPerDay: z.number().int().positive().default(3),
  maxAllInTradeLossInr: z.number().positive().default(500),
  maxAllInDailyLossInr: z.number().positive().default(600),
  cooldownMinutes: z.number().int().nonnegative().default(5),
  tradeMode: z.nativeEnum(TradeMode).default(TradeMode.PAPER),
  session: StrategySessionSchema.default({
    start: '09:25',
    lastEntry: '14:45',
    timezone: 'Asia/Kolkata',
  }),
});

export type PriceActionMomentumConfig = z.infer<typeof PriceActionMomentumConfigSchema>;

export const PriceActionMomentumSignalResultSchema = z.object({
  signal: z.enum(['BUY_CE', 'BUY_PE', 'NO_TRADE']),
  direction: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
  priceChange: z.number(),
  totalMovement: z.number(),
  trendEfficiency: z.number(),
  bullishStructureConfirmations: z.number().int(),
  bearishStructureConfirmations: z.number().int(),
  mtfConfirmed: z.boolean(),
  mtfPriceChange: z.number().optional(),
  breakoutTriggered: z.boolean(),
  setupCandleHigh: z.number(),
  setupCandleLow: z.number(),
  currentPrice: z.number(),
  reasons: z.array(z.string()),
  timestamp: z.string(),
});

export type PriceActionMomentumSignalResult = z.infer<typeof PriceActionMomentumSignalResultSchema>;


