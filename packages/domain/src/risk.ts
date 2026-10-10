import { calculateOptionCharges } from './charges';
import { isValidLotQuantity } from './lot-size';

export interface EvaluateTradeRiskInput {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  lotSize: number;
  availableCash: number;
  maxCapitalInr: number; // e.g. 10000
  maxAllInTradeLossInr: number; // e.g. 500
  dailyLossCapInr: number; // e.g. 1500
  realizedNetDailyLossInr: number; // Positive number representing accumulated net loss today
  openRiskReservationsInr: number; // Current open positions worst-case risk
  currentOpenPositions: number;
  maxOpenPositions: number;
  slippageBufferPct?: number; // e.g. 2% buffer on option premium
  killSwitchActive: boolean;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  reasons: string[];
  capitalRequired: number;
  grossLossAtStop: number;
  estimatedRoundTripCosts: number;
  slippageBuffer: number;
  allInRisk: number;
  targetGrossProfit: number;
  remainingDailyRiskBudget: number;
}

export function evaluateTradeRisk(input: EvaluateTradeRiskInput): RiskEvaluationResult {
  const reasons: string[] = [];
  const numericValues = [input.entryPrice, input.stopPrice, input.targetPrice, input.quantity, input.lotSize, input.availableCash, input.maxCapitalInr, input.maxAllInTradeLossInr, input.dailyLossCapInr, input.realizedNetDailyLossInr, input.openRiskReservationsInr, input.currentOpenPositions, input.maxOpenPositions, input.slippageBufferPct ?? 0.02];
  if (!numericValues.every(Number.isFinite) || input.entryPrice <= 0 || input.stopPrice <= 0 || input.targetPrice <= 0 || !Number.isInteger(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.lotSize) || input.lotSize <= 0) {
    return { allowed: false, reasons: ['All prices, balances and risk limits must be finite numbers.'], capitalRequired: 0, grossLossAtStop: 0, estimatedRoundTripCosts: 0, slippageBuffer: 0, allInRisk: 0, targetGrossProfit: 0, remainingDailyRiskBudget: 0 };
  }
  const {
    entryPrice,
    stopPrice,
    targetPrice,
    quantity,
    lotSize,
    availableCash,
    maxCapitalInr,
    maxAllInTradeLossInr,
    dailyLossCapInr,
    realizedNetDailyLossInr,
    openRiskReservationsInr,
    currentOpenPositions,
    maxOpenPositions,
    slippageBufferPct = 0.02,
    killSwitchActive,
  } = input;

  if (killSwitchActive) {
    reasons.push('Kill switch is ACTIVE: All new trades are blocked.');
  }

  if (entryPrice <= 0 || stopPrice <= 0 || targetPrice <= 0) {
    reasons.push('Prices must be positive values.');
  }

  if (stopPrice >= entryPrice) {
    reasons.push('Stop price must be strictly lower than entry price for a long position.');
  }

  if (targetPrice <= entryPrice) {
    reasons.push('Target price must be strictly higher than entry price for a long position.');
  }

  if (!isValidLotQuantity(quantity, lotSize)) {
    reasons.push(`Order quantity (${quantity}) is not a multiple of standard lot size (${lotSize}).`);
  }

  if (currentOpenPositions >= maxOpenPositions) {
    reasons.push(`Maximum open positions limit reached (${currentOpenPositions}/${maxOpenPositions}).`);
  }

  // Calculate transaction charges for stop exit leg
  const chargesAtStop = calculateOptionCharges({
    buyPrice: entryPrice,
    sellPrice: stopPrice,
    quantity,
  });

  // Calculate transaction charges for target exit leg
  const chargesAtTarget = calculateOptionCharges({
    buyPrice: entryPrice,
    sellPrice: targetPrice,
    quantity,
  });

  // Slippage buffer on option premium
  const slippageBuffer = Number(((entryPrice * slippageBufferPct) * quantity).toFixed(2));

  // Capital Required = P * Q + entry charges + slippage reserve
  const grossCapital = entryPrice * quantity;
  const capitalRequired = Number((grossCapital + chargesAtStop.totalRoundTripCharges + slippageBuffer).toFixed(2));

  if (capitalRequired > availableCash) {
    reasons.push(
      `Required capital (₹${capitalRequired.toFixed(2)}) exceeds available cash (₹${availableCash.toFixed(2)}).`,
    );
  }

  if (capitalRequired > maxCapitalInr) {
    reasons.push(
      `Required capital (₹${capitalRequired.toFixed(2)}) exceeds account-level max capital cap (₹${maxCapitalInr}).`,
    );
  }

  // GrossLossAtStop = (P - plannedStopFillPrice) * Q
  const grossLossAtStop = Number(((entryPrice - stopPrice) * quantity).toFixed(2));

  // AllInRisk = GrossLossAtStop + estimated round-trip costs + slippage buffer
  const allInRisk = Number(
    (grossLossAtStop + chargesAtStop.totalRoundTripCharges + slippageBuffer).toFixed(2),
  );

  // RemainingRiskBudget = dailyLossCap - realizedNetLoss - worstCaseOpenRiskReservations
  const remainingDailyRiskBudget = Number(
    Math.max(0, dailyLossCapInr - realizedNetDailyLossInr - openRiskReservationsInr).toFixed(2),
  );

  const effectiveMaxTradeRisk = Math.min(maxAllInTradeLossInr, remainingDailyRiskBudget);

  if (allInRisk > effectiveMaxTradeRisk) {
    reasons.push(
      `All-in risk (₹${allInRisk.toFixed(2)}) exceeds allowable limit (₹${effectiveMaxTradeRisk.toFixed(2)}). Max per-trade is ₹${maxAllInTradeLossInr}, remaining daily budget is ₹${remainingDailyRiskBudget.toFixed(2)}.`,
    );
  }

  // TargetGrossProfit = targetNetProfit + estimated round-trip costs + slippage buffer
  const grossTargetGain = (targetPrice - entryPrice) * quantity;
  const targetGrossProfit = Number(
    (grossTargetGain - chargesAtTarget.totalRoundTripCharges - slippageBuffer).toFixed(2),
  );

  return {
    allowed: reasons.length === 0,
    reasons,
    capitalRequired,
    grossLossAtStop,
    estimatedRoundTripCosts: chargesAtStop.totalRoundTripCharges,
    slippageBuffer,
    allInRisk,
    targetGrossProfit,
    remainingDailyRiskBudget,
  };
}
