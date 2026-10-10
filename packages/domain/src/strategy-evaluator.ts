import {
  AgentType,
  OrderSide,
  ProductType,
  ProposalStatus,
  QuoteSnapshot,
  StrategyConfig,
  TradeProposal,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle, calculateEMA, calculateRSI, calculateVWAP, validateWarmup } from './indicators';
import { getStandardLotSize } from './lot-size';

export interface StrategyEvaluationContext {
  strategy: StrategyConfig;
  underlyingCandles: Candle[]; // Strictly confirmed closed candles
  candidateQuote: QuoteSnapshot;
  currentTimeIst?: string; // Optional "HH:MM" e.g. "10:15"
}

export interface StrategyEvaluationResult {
  passed: boolean;
  reasons: string[];
  signal: 'BUY_CALL' | 'BUY_PUT' | 'NONE';
  confidence: number;
  metrics: {
    underlyingEma20?: number;
    previousUnderlyingEma20?: number;
    underlyingClose?: number;
    previousUnderlyingClose?: number;
    rsi14?: number;
    vwap?: number;
    spreadPct?: number;
    volume?: number;
    closedCandlesCount: number;
    isWarmedUp: boolean;
  };
  proposal?: TradeProposal;
}

/**
 * Deterministic Strategy Evaluator
 * Evaluates entry rules on closed bars and produces expiring TradeProposal objects.
 * Strict Invariant: No broker order execution. Pure evaluation and proposal drafting.
 */
export function evaluateStrategyRules(
  context: StrategyEvaluationContext,
): StrategyEvaluationResult {
  const { strategy, underlyingCandles, candidateQuote, currentTimeIst } = context;
  const reasons: string[] = [];

  const emaPeriod = strategy.entry?.emaPeriod ?? 20;
  const rsiPeriod = strategy.entry?.rsiPeriod ?? 14;
  const rsiThreshold = strategy.entry?.rsiThreshold ?? 55;
  const maxSpreadPct = strategy.entry?.maxBidAskSpreadPct ?? 1.0;
  const minVolume = strategy.entry?.minVolume ?? 1000;

  // 1. Warm-up verification
  const warmup = validateWarmup(underlyingCandles, emaPeriod, rsiPeriod);
  if (!warmup.isWarmedUp) {
    return {
      passed: false,
      reasons: [warmup.reason ?? 'Insufficient warm-up candles for indicators.'],
      signal: 'NONE',
      confidence: 0,
      metrics: {
        closedCandlesCount: underlyingCandles.length,
        isWarmedUp: false,
      },
    };
  }

  // Need at least 2 closed candles to evaluate a transition/cross
  if (underlyingCandles.length < 2) {
    return {
      passed: false,
      reasons: ['Need at least 2 closed bars to evaluate EMA transition.'],
      signal: 'NONE',
      confidence: 0,
      metrics: {
        closedCandlesCount: underlyingCandles.length,
        isWarmedUp: true,
      },
    };
  }

  // 2. Session time gate
  if (currentTimeIst) {
    const sessionStart = strategy.session?.start ?? '09:25';
    const lastEntry = strategy.session?.lastEntry ?? '14:45';
    if (currentTimeIst < sessionStart || currentTimeIst > lastEntry) {
      reasons.push(
        `Outside permitted entry session: ${currentTimeIst} IST (allowed: ${sessionStart} to ${lastEntry})`,
      );
    }
  }

  // 3. Indicator calculations on closed bars
  const closes = underlyingCandles.map((c) => c.close);
  const emaValues = calculateEMA(closes, emaPeriod);
  const rsiValues = calculateRSI(closes, rsiPeriod);
  const vwapValues = calculateVWAP(underlyingCandles);

  const currentEma = emaValues[emaValues.length - 1]!;
  const prevEma = emaValues[emaValues.length - 2]!;
  const currentClose = closes[closes.length - 1]!;
  const prevClose = closes[closes.length - 2]!;
  const currentRsi = rsiValues[rsiValues.length - 1]!;
  const currentVwap = vwapValues.length > 0 ? vwapValues[vwapValues.length - 1]! : currentClose;

  // 4. EMA Bullish Trend Condition
  const isEmaBullish =
    (prevClose <= prevEma && currentClose > currentEma) ||
    (currentClose > currentEma && currentClose >= prevClose);

  if (!isEmaBullish) {
    reasons.push(
      `EMA(${emaPeriod}) bullish condition not met: Close=${currentClose}, EMA=${currentEma}, PrevClose=${prevClose}`,
    );
  }

  // 5. RSI Momentum Condition
  const isRsiBullish = currentRsi >= rsiThreshold;
  if (!isRsiBullish) {
    reasons.push(
      `RSI(${rsiPeriod}) is ${currentRsi.toFixed(2)}, below required momentum threshold ${rsiThreshold}`,
    );
  }

  // 6. Candidate Quote Liquidity & Spread Filter
  const ask = candidateQuote.askPrice > 0 ? candidateQuote.askPrice : candidateQuote.lastPrice;
  const bid = candidateQuote.bidPrice > 0 ? candidateQuote.bidPrice : candidateQuote.lastPrice;
  const spreadPct = ask > 0 ? Number((((ask - bid) / ask) * 100).toFixed(2)) : 999;

  if (spreadPct > maxSpreadPct) {
    reasons.push(
      `Bid/Ask spread ${spreadPct.toFixed(2)}% exceeds maximum permitted ${maxSpreadPct}%`,
    );
  }

  if (candidateQuote.volume < minVolume) {
    reasons.push(
      `Volume ${candidateQuote.volume} is below minimum requirement ${minVolume}`,
    );
  }

  const metrics = {
    underlyingEma20: currentEma,
    previousUnderlyingEma20: prevEma,
    underlyingClose: currentClose,
    previousUnderlyingClose: prevClose,
    rsi14: currentRsi,
    vwap: currentVwap,
    spreadPct,
    volume: candidateQuote.volume,
    closedCandlesCount: underlyingCandles.length,
    isWarmedUp: true,
  };

  const allConditionsPassed = reasons.length === 0;
  if (!allConditionsPassed) {
    return {
      passed: false,
      reasons,
      signal: 'NONE',
      confidence: 0,
      metrics,
    };
  }

  // 7. Sizing, Financial Guardrails & Proposal Drafting
  const lotSize = getStandardLotSize(candidateQuote.instrumentKey || strategy.underlying);
  const quantity = lotSize; // 1 lot default
  const suggestedEntryPrice = ask;

  // Planned stop: conservative buffer (e.g. 7 points or 7% of premium)
  const stopPoints = Math.max(5, Number((suggestedEntryPrice * 0.08).toFixed(2)));
  const suggestedStopPrice = Math.max(1, Number((suggestedEntryPrice - stopPoints).toFixed(2)));

  // Target points calculated to achieve target net profit after ₹60 charges
  const targetNetProfitInr = strategy.risk?.targetNetProfitInr ?? strategy.targetNetProfitInr ?? 300;
  const estimatedChargesBudget = strategy.risk?.maxRoundTripCostBudgetInr ?? 60;
  const requiredGrossGain = targetNetProfitInr + estimatedChargesBudget;
  const targetPoints = Math.max(6, Number((requiredGrossGain / quantity).toFixed(2)));
  const suggestedTargetPrice = Number((suggestedEntryPrice + targetPoints).toFixed(2));

  // Compute accurate round-trip charges
  const chargeBreakdown = calculateOptionCharges({
    buyPrice: suggestedEntryPrice,
    sellPrice: suggestedTargetPrice,
    quantity,
  });

  const estimatedRoundTripCosts = chargeBreakdown.totalRoundTripCharges;
  const slippageBuffer = 10.0; // ₹10 slippage buffer
  const grossLossAtStop = Number(((suggestedEntryPrice - suggestedStopPrice) * quantity).toFixed(2));
  const allInMaxLoss = Number((grossLossAtStop + estimatedRoundTripCosts + slippageBuffer).toFixed(2));
  const estimatedCapitalRequired = Number(
    (suggestedEntryPrice * quantity + estimatedRoundTripCosts).toFixed(2),
  );
  const estimatedNetProfit = Number(
    ((suggestedTargetPrice - suggestedEntryPrice) * quantity - estimatedRoundTripCosts - slippageBuffer).toFixed(2),
  );

  // 8. Deterministic Risk Gate Validation
  const maxAllInTradeLossInr =
    strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 500;
  const maxCapitalInr = strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? 10000;

  if (allInMaxLoss > maxAllInTradeLossInr) {
    return {
      passed: false,
      reasons: [
        `Risk Gate Violation: All-in max loss ₹${allInMaxLoss} exceeds trade cap ₹${maxAllInTradeLossInr}`,
      ],
      signal: 'NONE',
      confidence: 0,
      metrics,
    };
  }

  if (estimatedCapitalRequired > maxCapitalInr) {
    return {
      passed: false,
      reasons: [
        `Capital Gate Violation: Required funds ₹${estimatedCapitalRequired} exceeds max cap ₹${maxCapitalInr}`,
      ],
      signal: 'NONE',
      confidence: 0,
      metrics,
    };
  }

  // 9. Calibrated Confidence Score
  let confidence = 0.72;
  if (currentRsi > 60) confidence += 0.08;
  if (spreadPct < 0.4) confidence += 0.08;
  if (currentClose > currentVwap) confidence += 0.05;
  confidence = Math.min(0.95, Number(confidence.toFixed(2)));

  const now = Date.now();
  const proposal: TradeProposal = {
    id: `prop_${now}_${Math.random().toString(36).substring(2, 7)}`,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    proposingAgent: AgentType.STRATEGY_ANALYST,
    instrumentKey: candidateQuote.instrumentKey,
    symbol: candidateQuote.instrumentKey.split('|')[1] ?? candidateQuote.instrumentKey,
    side: OrderSide.BUY,
    product: ProductType.I,
    suggestedEntryPrice,
    suggestedStopPrice,
    suggestedTargetPrice,
    lotSize,
    quantity,
    estimatedCapitalRequired,
    estimatedRoundTripCosts,
    allInMaxLoss,
    estimatedNetProfit,
    evidence: {
      indicators: {
        ema20: currentEma,
        rsi14: currentRsi,
        vwap: currentVwap,
        spreadPct,
        volume: candidateQuote.volume,
        closedBars: underlyingCandles.length,
      },
      rationale: `5m EMA(${emaPeriod}) bullish confirmation + RSI(${rsiPeriod})=${currentRsi.toFixed(1)} > ${rsiThreshold} with tight spread (${spreadPct}%).`,
      confidence,
    },
    status: ProposalStatus.PENDING,
    expiresAt: new Date(now + 180000).toISOString(), // 3-minute TTL
    createdAt: new Date(now).toISOString(),
  };

  return {
    passed: true,
    reasons: ['All strategy entry rules and deterministic risk gates satisfied.'],
    signal: 'BUY_CALL',
    confidence,
    metrics,
    proposal,
  };
}
