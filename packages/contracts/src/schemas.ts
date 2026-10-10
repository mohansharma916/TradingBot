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
} from './enums';

// Environment Schema
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WORKER_PORT: z.coerce.number().default(4001),
  CORS_ORIGIN: z.string().default('http://localhost:8081,http://localhost:3000'),
  JWT_SECRET: z.string().min(16).default('super_secret_dev_key_change_in_production_min_32_chars'),
  MFA_ENABLED: z.coerce.boolean().default(false),
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
  LIVE_EXECUTION_ENABLED: z.coerce.boolean().default(false),
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
  }).optional(),
});

export const OptionChainResultSchema = z.object({
  underlying: z.string(),
  spotPrice: z.number().positive(),
  expiryDate: z.string(),
  availableExpiries: z.array(z.string()),
  lotSize: z.number().int().positive(),
  strikes: z.array(OptionChainStrikeSchema),
  timestamp: z.string().datetime(),
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

// Strategy Config Schema
export const StrategyConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
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
});
export type BacktestTradeRecord = z.infer<typeof BacktestTradeRecordSchema>;

export const BacktestRequestSchema = z.object({
  days: z.number().int().min(1).max(90).default(14),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1d']).default('5m'),
  initialCapital: z.number().positive().default(10000),
  underlying: z.enum(['NIFTY', 'BANKNIFTY']).default('NIFTY'),
  useTrailingStop: z.boolean().default(true),
  trailingActivationProfitInr: z.number().nonnegative().default(150),
  trailingStepInr: z.number().nonnegative().default(50),
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
  dataSource: z.string().default('REAL_MARKET_DATA'),
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
  profitFactor: z.number(),
  trades: z.array(BacktestTradeRecordSchema),
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
  spotPrice: z.number().positive(),
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
  id: z.string().uuid(),
  intentId: z.string().uuid(),
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
  id: z.string().uuid(),
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
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  instrumentKey: z.string(),
  side: z.nativeEnum(OrderSide),
  fillQty: z.number().int().positive(),
  fillPrice: z.number().positive(),
  charges: ChargeBreakdownSchema,
  timestamp: z.string().datetime(),
  estimatedCharges: z.number().nonnegative(),
  actualCharges: z.number().nonnegative(),
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
    rateLimiterTokensRemaining: z.number().nonnegative(),
    egressIpMatch: z.boolean(),
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


