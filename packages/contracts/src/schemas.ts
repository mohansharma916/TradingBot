import { z } from 'zod';
import {
  AgentType,
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

// Strategy Config Schema
export const StrategyConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: z.nativeEnum(StrategyStatus).default(StrategyStatus.DRAFT),
  tradeMode: z.nativeEnum(TradeMode).default(TradeMode.PAPER),
  underlying: z.string(), // "NIFTY", "BANKNIFTY"
  timeframe: z.string(), // "1m", "5m", "15m"
  maxCapitalInr: z.number().positive().max(10000), // Account hard cap
  maxAllInTradeLossInr: z.number().positive().max(500),
  maxAllInDailyLossInr: z.number().positive().max(1500),
  targetNetProfitInr: z.number().positive().default(300),
  maxRoundTripCostBudgetInr: z.number().positive().default(60),
  maxOpenPositions: z.number().int().positive().default(1),
  requiresApproval: z.boolean().default(true),
});

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

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
