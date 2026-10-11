import {
  AgentType, AllowedOptionType, Instrument, InstrumentType, OrderSide, ProductType,
  ProposalStatus, QuoteSnapshot, StrategyConfig, TradeProposal,
  TrailingProfitMode,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle, calculateEMA, calculateRSI, calculateVWAP } from './indicators';
import { buildIndicatorCache, convertLegacyStrategyToAst, evaluateStrategyAst } from './strategy-rule-evaluator';

export interface StrategyEvaluationContext {
  strategy: StrategyConfig;
  underlyingCandles: Candle[];
  candidateQuote: QuoteSnapshot;
  candidateInstrument?: Pick<Instrument, 'instrumentKey' | 'symbol' | 'underlying' | 'instrumentType' | 'lotSize' | 'tickSize' | 'expiry'>;
  currentTimeIst?: string;
  candleTimestampBasis?: 'OPEN' | 'CLOSE';
}
export interface StrategyEvaluationResult {
  passed: boolean;
  reasons: string[];
  signal: 'BUY_CALL' | 'BUY_PUT' | 'NONE';
  /** Deterministic rule satisfaction, never a calibrated probability of profit. */
  confidence: number;
  confidenceKind?: 'HEURISTIC';
  metrics: {
    underlyingEma20?: number; previousUnderlyingEma20?: number;
    underlyingClose?: number; previousUnderlyingClose?: number;
    rsi14?: number; vwap?: number; spreadPct?: number; volume?: number;
    closedCandlesCount: number; isWarmedUp: boolean;
  };
  proposal?: TradeProposal;
}
export function strategyTimeframeMinutes(timeframe = '5m'): number {
  const values: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1d': 1440 };
  return values[timeframe] ?? 0;
}
/** Shared closed-bar AST evaluation used by scanning and modeled backtests. */
export function evaluateStrategySignal(input: { strategy: StrategyConfig; candles: Candle[]; currentTimeIst?: string; barIndex?: number; candleTimestampBasis?: 'OPEN' | 'CLOSE' }) {
  const { strategy, candles } = input;
  const ast = convertLegacyStrategyToAst(strategy);
  const reasons: string[] = [];
  const minutes = strategyTimeframeMinutes(strategy.timeframe);
  if (!minutes || (ast.indicators ?? []).some((indicator) => indicator.timeframe && indicator.timeframe !== strategy.timeframe)) reasons.push('Unsupported or mixed indicator timeframe; provide aligned candles.');
  if (candles.some((c, index) => !Number.isFinite(Number(new Date(c.timestamp))) || ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close) || c.low <= 0 || c.volume < 0 || (index > 0 && Number(new Date(c.timestamp)) <= Number(new Date(candles[index - 1]!.timestamp))))) reasons.push('Candle history is invalid or not strictly chronological.');
  if (input.currentTimeIst && (input.currentTimeIst < (strategy.session?.start ?? '09:25') || input.currentTimeIst > (strategy.session?.lastEntry ?? '14:45'))) reasons.push('Outside permitted entry session.');
  if (reasons.length) return { bullishSignal: false, bearishSignal: false, isWarmedUp: false, reasons };
  const cache = buildIndicatorCache(candles, ast, { timeframeMinutes: minutes, candleTimestampBasis: input.candleTimestampBasis ?? 'OPEN' });
  const result = evaluateStrategyAst(ast, input.barIndex ?? candles.length - 1, candles, cache);
  if (!result.isWarmedUp) reasons.push(`Insufficient warm-up candles: need at least ${cache.warmupRequired + 1} closed bars.`);
  if (result.bullishSignal && result.bearishSignal) { result.bullishSignal = false; result.bearishSignal = false; reasons.push('Conflicting bullish and bearish rules; entry blocked.'); }
  if (!result.bullishSignal && !result.bearishSignal && !reasons.length) reasons.push('Configured strategy entry rules are not satisfied.');
  return { ...result, reasons };
}

/** Option-premium exits can be shared without inventing a live option delta. Other bases fail closed. */
export function strategyExitLevels(input: { strategy: StrategyConfig; entryPrice: number; quantity: number; slippageBufferInr?: number; tickSize?: number }) {
  const { strategy, entryPrice, quantity, slippageBufferInr = 0, tickSize = 0.05 } = input;
  const exits = strategy.astConfig?.exitRules;
  if (exits?.exitOnIndicatorReversal) return { error: 'Generic indicator-reversal exits require an explicit reversal condition and are not supported.' };
  const stopBasis = exits?.stopLossBasis ?? 'OPTION_PREMIUM';
  const targetBasis = exits?.targetProfitBasis ?? 'OPTION_PREMIUM';
  if (!['OPTION_PREMIUM', 'PERCENTAGE'].includes(stopBasis) || !['OPTION_PREMIUM', 'PERCENTAGE', 'RISK_REWARD'].includes(targetBasis)) return { error: 'This exit basis requires actual option/underlying linkage; it is not supported by the premium execution model.' };
  const riskCap = strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 500;
  const basicCharges = calculateOptionCharges({ buyPrice: entryPrice, sellPrice: entryPrice, quantity }).totalRoundTripCharges;
  let stopPoints = exits?.stopLossValue ?? strategy.exit?.stopLossPoints;
  if (stopBasis === 'PERCENTAGE') stopPoints = entryPrice * (stopPoints ?? 0) / 100;
  const maxAffordableStopPoints = Math.max(1, (riskCap - basicCharges - slippageBufferInr - 5) / quantity);
  if (stopPoints === undefined || stopPoints > maxAffordableStopPoints) {
    stopPoints = maxAffordableStopPoints;
  }
  if (!Number.isFinite(stopPoints) || stopPoints <= 0 || stopPoints >= entryPrice) return { error: 'No affordable positive protective stop fits the all-in risk budget.' };
  // Round the stop upward (tighter risk), target upward (required net proceeds).
  const stopPrice = Math.ceil((entryPrice - stopPoints) / tickSize - 1e-9) * tickSize;
  let targetPoints = exits?.targetProfitValue ?? strategy.exit?.targetPoints;
  if (targetBasis === 'PERCENTAGE') targetPoints = entryPrice * (targetPoints ?? 0) / 100;
  if (targetBasis === 'RISK_REWARD') targetPoints = stopPoints * (targetPoints ?? 0);
  if (targetPoints === undefined) {
    const targetNet = strategy.risk?.targetNetProfitInr ?? strategy.targetNetProfitInr ?? 300;
    targetPoints = (targetNet + basicCharges + slippageBufferInr) / quantity;
    for (let i = 0; i < 3; i++) targetPoints = (targetNet + calculateOptionCharges({ buyPrice: entryPrice, sellPrice: entryPrice + targetPoints, quantity }).totalRoundTripCharges + slippageBufferInr) / quantity;
  }
  if (!Number.isFinite(targetPoints) || targetPoints <= 0) return { error: 'A positive target is required.' };
  return { stopPrice: Number(stopPrice.toFixed(6)), targetPrice: Number((Math.ceil((entryPrice + targetPoints) / tickSize - 1e-9) * tickSize).toFixed(6)) };
}

export function evaluateStrategyRules(context: StrategyEvaluationContext): StrategyEvaluationResult {
  const { strategy, underlyingCandles: candles, candidateQuote: quote, candidateInstrument: instrument } = context;
  const evaluated = evaluateStrategySignal({ strategy, candles, currentTimeIst: context.currentTimeIst, candleTimestampBasis: context.candleTimestampBasis ?? 'CLOSE' });
  const reasons = [...evaluated.reasons];
  const ast = convertLegacyStrategyToAst(strategy);
  if (ast.trailingProfit?.enabled && ast.trailingProfit.mode && ast.trailingProfit.mode !== TrailingProfitMode.FIXED_STEP) reasons.push('This runtime requires an explicit supported fixed-step trailing mode.');
  const closes = candles.map((c) => c.close);
  const ema = calculateEMA(closes, strategy.entry?.emaPeriod ?? 20);
  const rsi = calculateRSI(closes, strategy.entry?.rsiPeriod ?? 14);
  const vwap = reasons.some((reason) => reason.includes('history is invalid')) ? [] : calculateVWAP(candles);
  const spreadPct = quote.askPrice > 0 ? 100 * (quote.askPrice - quote.bidPrice) / quote.askPrice : Infinity;
  const metrics = { underlyingEma20: ema.at(-1), previousUnderlyingEma20: ema.at(-2), underlyingClose: closes.at(-1), previousUnderlyingClose: closes.at(-2), rsi14: rsi.at(-1), vwap: vwap.at(-1), spreadPct, volume: quote.volume, closedCandlesCount: candles.length, isWarmedUp: evaluated.isWarmedUp };
  const reject = (): StrategyEvaluationResult => ({ passed:false, reasons, signal:'NONE', confidence:0, confidenceKind:'HEURISTIC', metrics });
  if (!instrument || instrument.instrumentKey !== quote.instrumentKey || instrument.underlying !== strategy.underlying || !Number.isInteger(instrument.lotSize) || instrument.lotSize <= 0 || !Number.isFinite(instrument.tickSize) || instrument.tickSize <= 0) reasons.push('Authoritative matching option contract metadata is required.');
  const age = Date.now() - Date.parse(quote.timestamp);
  if (quote.isStale || !Number.isFinite(age) || age < -1000 || age > 3000 || ![quote.bidPrice,quote.askPrice,quote.lastPrice,quote.volume,quote.bidQty,quote.askQty].every(Number.isFinite) || quote.bidPrice <= 0 || quote.askPrice < quote.bidPrice || quote.bidQty <= 0 || quote.askQty <= 0) reasons.push('Fresh two-sided executable market depth is required.');
  if (spreadPct > (ast.contractSelection?.maxBidAskSpreadPct ?? strategy.entry?.maxBidAskSpreadPct ?? 1)) reasons.push('Bid/Ask spread exceeds the configured limit.');
  if (quote.volume < (ast.contractSelection?.minVolume ?? strategy.entry?.minVolume ?? 1000)) reasons.push('Volume is below the configured minimum.');
  if (quote.openInterest < (ast.contractSelection?.minOpenInterest ?? 0)) reasons.push('Open interest is below the configured minimum.');
  if (quote.askPrice < (ast.contractSelection?.minPremium ?? 0) || quote.askPrice > (ast.contractSelection?.maxPremium ?? Infinity)) reasons.push('Option premium is outside the configured range.');
  const expectedType = evaluated.bullishSignal ? InstrumentType.CE : InstrumentType.PE;
  const allowedType = evaluated.bullishSignal ? AllowedOptionType.LONG_CALL : AllowedOptionType.LONG_PUT;
  if (instrument && (instrument.instrumentType !== expectedType || !(strategy.allowedInstruments ?? []).includes(allowedType))) reasons.push('Candidate contract does not match the configured signal direction.');
  if (ast.contractSelection?.optionSide === 'LONG_CE' && expectedType !== InstrumentType.CE || ast.contractSelection?.optionSide === 'LONG_PE' && expectedType !== InstrumentType.PE) reasons.push('Signal does not match AST contract direction.');
  if (instrument?.expiry && instrument.expiry.slice(0,10) < new Date(Date.now()+330*60000).toISOString().slice(0,10)) reasons.push('Contract has expired.');
  if (reasons.length || !instrument) return reject();
  const quantity = instrument.lotSize;
  const entry = Math.ceil(quote.askPrice / instrument.tickSize - 1e-9) * instrument.tickSize;
  const slippage = Number((entry * quantity * 0.02).toFixed(2));
  const levels = strategyExitLevels({ strategy, entryPrice: entry, quantity, slippageBufferInr: slippage, tickSize: instrument.tickSize });
  if (levels.error || levels.stopPrice === undefined || levels.targetPrice === undefined) { reasons.push(levels.error ?? 'Invalid exits.'); return reject(); }
  const stopCharges = calculateOptionCharges({buyPrice:entry,sellPrice:levels.stopPrice,quantity}).totalRoundTripCharges;
  const targetCharges = calculateOptionCharges({buyPrice:entry,sellPrice:levels.targetPrice,quantity}).totalRoundTripCharges;
  const estimatedCosts = Math.max(stopCharges,targetCharges);
  const allInMaxLoss = Number(((entry - levels.stopPrice) * quantity + stopCharges + slippage).toFixed(2));
  const capital = Number((entry * quantity + estimatedCosts + slippage).toFixed(2));
  const netProfit = Number(((levels.targetPrice - entry) * quantity - targetCharges - slippage).toFixed(2));
  if (allInMaxLoss > (strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 500)) reasons.push('Risk Gate Violation: configured stop exceeds the all-in trade cap.');
  if (capital > (strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? 10000)) reasons.push('Capital Gate Violation: option premium plus costs exceeds the capital cap.');
  if (estimatedCosts > (strategy.risk?.maxRoundTripCostBudgetInr ?? strategy.maxRoundTripCostBudgetInr ?? Infinity)) reasons.push('Estimated charges exceed the configured cost budget.');
  if (netProfit <= 0) reasons.push('The configured target has no positive estimated net proceeds after costs.');
  if (reasons.length) return reject();
  const now = Date.now();
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => { const random = Math.floor(Math.random()*16); return (character === 'x' ? random : random & 3 | 8).toString(16); });
  const proposal:TradeProposal = { id, strategyId:strategy.id, strategyVersion:strategy.version, versionHash:strategy.versionHash, proposingAgent:AgentType.STRATEGY_ANALYST, instrumentKey:instrument.instrumentKey, symbol:instrument.symbol, side:OrderSide.BUY, product:ProductType.I, suggestedEntryPrice:entry, suggestedStopPrice:levels.stopPrice, suggestedTargetPrice:levels.targetPrice, lotSize:quantity,quantity,estimatedCapitalRequired:capital,estimatedRoundTripCosts:estimatedCosts,allInMaxLoss,estimatedNetProfit:netProfit,evidence:{indicators:{closedBars:candles.length,spreadPct,confidenceKind:'RULE_SATISFACTION'},rationale:'Configured closed-bar AST rules are satisfied. Score indicates rule satisfaction, not a calibrated probability of profit; costs and fills remain estimates.',confidence:1},status:ProposalStatus.PENDING,expiresAt:new Date(now+180000).toISOString(),createdAt:new Date(now).toISOString() };
  return {passed:true,reasons:['Configured entry rules and estimated financial gates satisfied.'],signal:evaluated.bullishSignal?'BUY_CALL':'BUY_PUT',confidence:1,confidenceKind:'HEURISTIC',metrics,proposal};
}
