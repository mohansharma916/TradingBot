/**
 * AUDIT OBSERVATIONS ONLY: these deliberately artificial candles expose current engine defects.
 * This script is evidence, not a passing correctness suite, historical performance or trading advice.
 * Network requests are explicitly denied; no broker account, credentials or orders are used.
 * Run: pnpm exec tsx docs/audit/execution-backtest-audit.mts
 */
import { runStrategyBacktest } from '../../packages/domain/src/backtest-engine.ts';
import { strategyExitLevels, evaluateStrategyRules } from '../../packages/domain/src/strategy-evaluator.ts';
import { calculateOptionCharges } from '../../packages/domain/src/charges.ts';

globalThis.fetch = async () => { throw new Error('Network disabled in isolated backtest probe.'); };
const config = () => ({
  id:'550e8400-e29b-41d4-a716-446655440001',name:'Accounting audit fixture',version:1,
  underlying:'NIFTY',timeframe:'5m',allowedInstruments:['LONG_CALL'],
  session:{start:'09:15',lastEntry:'14:45',timezone:'Asia/Kolkata'},
  risk:{maxCapitalInr:4000,maxAllInTradeLossInr:500,maxAllInDailyLossInr:1500,maxOpenPositions:1,maxTradesPerDay:10,targetNetProfitInr:300,maxRoundTripCostBudgetInr:200},
  astConfig:{direction:'BULLISH',indicators:[],bullishEntry:{id:'always',operator:'AND',conditions:[{id:'signal',left:{type:'NUMBER',value:1},comparison:'GT',right:{type:'NUMBER',value:0}}]},entryRules:{allowReentry:true,cooldownBars:0},exitRules:{stopLossBasis:'OPTION_PREMIUM',stopLossValue:2,targetProfitBasis:'OPTION_PREMIUM',targetProfitValue:10,marketCutoffTime:'15:10'}},
});
const bars = (count=6,spot=10000) => Array.from({length:count},(_,i)=>({timestamp:new Date(Date.parse('2026-10-12T03:45:00Z')+i*300000).toISOString(),open:spot,high:spot,low:spot,close:spot,volume:1000}));
const run = (candles:any[], strategy:any=config(), request:any={}) => runStrategyBacktest({strategy,candles,request:{initialCapital:10000,useTrailingStop:false,...request},dataSource:'ISOLATED_AUDIT_FIXTURE',lotSize:65,tickSize:0.05});
function output(name:string,result:any,extra:any={}) { console.log(JSON.stringify({name,error:result.error,trades:result.trades.map((t:any)=>({entryTime:t.entryTime,exitTime:t.exitTime,entry:t.entryPrice,exit:t.exitPrice,quantity:t.quantity,gross:t.grossPnl,charges:t.charges,net:t.netPnl,reason:t.exitReason,initialStop:t.initialStopPrice,trailingStop:t.trailingStopPrice})),finalCapital:result.finalCapital,net:result.netPnl,maxDrawdown:result.maxDrawdown,maxDrawdownPct:result.maxDrawdownPct,profitFactor:result.profitFactor,...extra})); }

// The known next-bar OPEN is already above the resting target, before its later low.
{
 const c=bars(5);c[4]={...c[4],open:10040,high:10040,low:9990,close:10000};const s=config();s.risk.maxTradesPerDay=1;
 output('known-gap-above-target-then-stop',run(c,s),{knownOpeningBid:74.95,restingTarget:65.05});
}
// Live risk accounting sums losing fills; winning fills cannot buy a new daily loss allowance.
{
 const c=bars(9);c[4]={...c[4],high:10025,close:10025};c[6]={...c[6],low:9990};c[8]={...c[8],low:9990};
 const s=config();s.risk.maxAllInDailyLossInr=300;s.astConfig.exitRules.stopLossValue=3;
 const r=run(c,s);output('wins-replenish-daily-loss-budget',r,{dailyLossCap:300,sumLosingNet:r.trades.reduce((sum:any,t:any)=>sum+Math.max(0,-t.netPnl),0)});
}
// A losing closed-bar MTM before the eventual profitable exit does not affect drawdown.
{
 const c=bars(6);c[4]={...c[4],low:9994,close:9994};c[5]={...c[5],high:10030,close:10030};
 const s=config();s.risk.maxTradesPerDay=1;s.astConfig.exitRules.stopLossValue=5;s.astConfig.exitRules.targetProfitValue=20;
 const r=run(c,s);const t=r.trades[0];const interimExitBid=51.95;
 output('unrealized-drawdown-omitted',r,{interimClosedBarEquity:10000+(interimExitBid-t.entryPrice)*t.quantity-calculateOptionCharges({buyPrice:t.entryPrice,sellPrice:interimExitBid,quantity:t.quantity}).totalRoundTripCharges});
}
// Last supplied bar is explicitly ignored by market-hours loop, but used as a real exit.
{
 const c=bars(5);c[4]={...c[4],timestamp:'2026-10-12T10:05:00Z',open:11000,high:11000,low:11000,close:11000};
 output('out-of-session-final-price',run(c));
}
// tick granularity and reported proceeds should agree with transaction accounting.
{
 const c=bars(4,22523);c[3]={...c[3],high:22524.333,close:22524.333};const s=config();s.risk.maxCapitalInr=10000;
 const r=run(c,s);output('off-tick-prices-and-recorded-gross',r,{entryTickRemainder:r.trades[0]!.entryPrice/0.05-Math.round(r.trades[0]!.entryPrice/0.05),grossFromRecordedPrices:(r.trades[0]!.exitPrice-r.trades[0]!.entryPrice)*r.trades[0]!.quantity});
}
// all winning results should use an explicit infinite/undefined PF, never zero.
{
 const c=bars(5);c[4]={...c[4],high:10025,close:10025};const s=config();s.risk.maxTradesPerDay=1;
 output('all-winners-profit-factor-zero',run(c,s));
}
// Backtest takes all affordable lots, production evaluator takes one broker contract lot.
{
 const s=config();s.risk.maxCapitalInr=10000;s.astConfig.exitRules.stopLossValue=2;
 output('position-sizing-multiple-lots',run(bars(4),s));
}
// Tick rounding can invalidate a correctly positive user-specified stop distance.
{
 const s=config();s.astConfig.exitRules.stopLossValue=0.01;
 console.log(JSON.stringify({name:'exit-levels-stop-rounds-to-entry',input:{entry:55.05,quantity:65,stopDistance:0.01,tick:0.05},levels:strategyExitLevels({strategy:s as any,entryPrice:55.05,quantity:65,tickSize:0.05})}));
 output('backtest-admits-stop-equal-to-entry',run(bars(4),s));
}
// Fixed-step trailing schema has distinct adjustment and gap; implementation uses only gap.
{
 const c=bars(6);c[4]={...c[4],high:10008,close:10008};c[5]={...c[5],open:10008,high:10008,low:10003,close:10003};
 const s:any=config();s.risk.maxTradesPerDay=1;s.astConfig.exitRules.targetProfitValue=20;
 s.astConfig.trailingProfit={enabled:true,mode:'FIXED_STEP',activationProfitInr:100,trailingGapInr:100,adjustmentStepInr:1000,profitLockInr:150,adjustmentFrequencyBars:10};
 output('trailing-adjustment1000',run(c,s,{useTrailingStop:true}));
 s.astConfig.trailingProfit.adjustmentStepInr=1;s.astConfig.trailingProfit.profitLockInr=1;s.astConfig.trailingProfit.adjustmentFrequencyBars=1;
 output('trailing-adjustment1',run(c,s,{useTrailingStop:true}));
}
{
 const s=config();s.risk.maxAllInTradeLossInr=200;
 const r=run(bars(4),s);output('one-tick-slippage-accepts-live-rejected-trade',r);
 const live=evaluateStrategyRules({strategy:s as any,underlyingCandles:bars(4),currentTimeIst:'10:00',candidateInstrument:{instrumentKey:'NSE_FO|12345',symbol:'FIXTURE',instrumentType:'CE',underlying:'NIFTY',lotSize:65,tickSize:0.05} as any,candidateQuote:{instrumentKey:'NSE_FO|12345',lastPrice:55.05,bidPrice:55,askPrice:55.05,bidQty:65,askQty:65,volume:10000,openInterest:10000,timestamp:new Date().toISOString(),isStale:false,depthKnown:true,provenance:'LIVE'} as any});
 console.log(JSON.stringify({name:'same-risk-cap-live-evaluator',passed:live.passed,reasons:live.reasons}));
}
{
 const s=config();s.astConfig.exitRules.targetProfitValue=0.10;s.risk.maxTradesPerDay=1;
 const c=bars(5);c[4]={...c[4],high:10001,close:10001};output('gross-target-reached-but-net-loss',run(c,s));
 const evaluation=evaluateStrategyRules({strategy:s as any,underlyingCandles:bars(4),currentTimeIst:'10:00',candidateInstrument:{instrumentKey:'NSE_FO|12345',symbol:'FIXTURE',instrumentType:'CE',underlying:'NIFTY',lotSize:65,tickSize:0.05} as any,candidateQuote:{instrumentKey:'NSE_FO|12345',lastPrice:55.05,bidPrice:55,askPrice:55.05,bidQty:65,askQty:65,volume:10000,openInterest:10000,timestamp:new Date().toISOString(),isStale:false,depthKnown:true,provenance:'LIVE'} as any});
 console.log(JSON.stringify({name:'same-small-target-live-evaluator',passed:evaluation.passed,reasons:evaluation.reasons}));
}
