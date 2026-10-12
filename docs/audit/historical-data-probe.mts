import { fetchRealHistoricalCandles, runStrategyBacktest } from '../../packages/domain/src/backtest-engine.ts';
import { BacktestRequestSchema } from '../../packages/contracts/src/schemas.ts';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const calls: { url: string; signal: boolean }[] = [];
const makeRows = (stepMinutes = 5, start = '2026-10-05T03:45:00Z', count = 20) => Array.from({ length: count }, (_, i) => [new Date(Date.parse(start) + i * stepMinutes * 60000).toISOString(), 10000 + i, 10002 + i, 9999 + i, 10001 + i, 1000, 0]);
let rows = makeRows();
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input); calls.push({url, signal: Boolean(init?.signal)});
  if (url.includes('upstox')) return {ok: true, json: async () => ({status:'success', data:{candles:rows}})} as any;
  return {ok:true,json:async()=>({chart:{result:[{timestamp:rows.map(r=>Date.parse(r[0] as string)/1000),indicators:{quote:[{open:rows.map(r=>r[1]),high:rows.map(r=>r[2]),low:rows.map(r=>r[3]),close:rows.map(r=>r[4]),volume:rows.map(r=>r[5])}]}}]}})} as any;
}) as any;

const strategy:any={id:'550e8400-e29b-41d4-a716-446655440001',name:'History probe',version:1,underlying:'NIFTY',timeframe:'15m',allowedInstruments:['LONG_CALL'],session:{start:'09:15',lastEntry:'14:45',timezone:'Asia/Kolkata'},risk:{maxCapitalInr:4000,maxAllInTradeLossInr:500,maxAllInDailyLossInr:1500,maxOpenPositions:1,maxTradesPerDay:3,targetNetProfitInr:300,maxRoundTripCostBudgetInr:200},astConfig:{direction:'BULLISH',indicators:[],bullishEntry:{id:'always',operator:'AND',conditions:[{id:'signal',left:{type:'NUMBER',value:1},comparison:'GT',right:{type:'NUMBER',value:0}}]},entryRules:{allowReentry:true,cooldownBars:0},exitRules:{stopLossBasis:'OPTION_PREMIUM',stopLossValue:2,targetProfitBasis:'OPTION_PREMIUM',targetProfitValue:10,marketCutoffTime:'15:10'}}};
try {
  for(const underlying of ['FINNIFTY','MIDCPNIFTY']) {
    calls.length=0;
    const result=await fetchRealHistoricalCandles({underlying,timeframe:'5m',fromDate:'2026-10-05',toDate:'2026-10-05',authToken:'fake-local-probe-token'});
    console.log(JSON.stringify({probe:'wrong_index',underlying,url:calls[0]?.url,dataSource:result.dataSource,firstOpen:result.candles[0]?.open,candles:result.candles.length}));
  }
  calls.length=0;
  try {
    const three=await fetchRealHistoricalCandles({underlying:'NIFTY',timeframe:'3m',fromDate:'2026-10-05',toDate:'2026-10-05',authToken:'fake-local-probe-token'});
    console.log(JSON.stringify({probe:'silently_changed_interval',requested:'3m',url:calls[0]?.url,spacingMinutes:(Date.parse(three.candles[1]!.timestamp)-Date.parse(three.candles[0]!.timestamp))/60000}));
  } catch (err: any) {
    console.log(JSON.stringify({probe:'rejected_unsupported_interval',requested:'3m',error:err.message}));
  }
  rows=makeRows(15);
  const request=BacktestRequestSchema.parse({fromDate:'2026-10-05',toDate:'2026-10-05',initialCapital:10000,useTrailingStop:false});
  const history=await fetchRealHistoricalCandles({underlying:'NIFTY',interval:strategy.timeframe,fromDate:request.fromDate,toDate:request.toDate,authToken:'fake-local-probe-token'});
  const result=runStrategyBacktest({strategy,candles:history.candles,request,dataSource:history.dataSource});
  console.log(JSON.stringify({probe:'API_default_tf_mismatch',strategyTimeframe:strategy.timeframe,requestTimeframe:request.timeframe,resultTimeframe:result.timeframe,inputSpacingMinutes:15,error:result.error??null,trades:result.totalTrades,firstTrade:result.trades[0]}));
  rows=makeRows();calls.length=0;Date.now=()=>Date.parse('2026-10-11T06:00:00Z');
  const short=await fetchRealHistoricalCandles({underlying:'NIFTY',days:90,timeframe:'5m'});
  console.log(JSON.stringify({probe:'incomplete_90_days_accepted',requestedDays:90,url:calls[0]?.url,candles:short.candles.length,actualSpanMinutes:(Date.parse(short.candles.at(-1)!.timestamp)-Date.parse(short.candles[0]!.timestamp))/60000,dataSource:short.dataSource}));
  Date.now=()=>Date.parse('2026-10-05T04:07:00Z');rows=makeRows(5,'2026-10-05T03:20:00Z',10);calls.length=0;
  const unfinished=await fetchRealHistoricalCandles({underlying:'NIFTY',days:1,timeframe:'5m',authToken:'fake-local-probe-token'});
  console.log(JSON.stringify({probe:'unfinished_candle',now:new Date(Date.now()).toISOString(),lastOpen:unfinished.candles.at(-1)!.timestamp,lastClose:new Date(Date.parse(unfinished.candles.at(-1)!.timestamp)+300000).toISOString(),fetchAbortSignal:calls[0]?.signal}));
  rows=makeRows();calls.length=0;
  try {
    const malformedDate=await fetchRealHistoricalCandles({underlying:'NIFTY',fromDate:'2026-10-05junk',toDate:'2026-10-05',authToken:'fake-local-probe-token'});
    console.log(JSON.stringify({probe:'malformed_date_accepted',schemaAccepts:BacktestRequestSchema.safeParse({fromDate:'2026-10-05junk'}).success,url:calls[0]?.url,candles:malformedDate.candles.length}));
  } catch (err: any) {
    console.log(JSON.stringify({probe:'malformed_date_rejected',error:err.message}));
  }
  const asCandles=(data:any[])=>data.map(r=>({timestamp:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]}));
  const fiveStrategy={...strategy,timeframe:'5m'};
  for (const date of ['2025-10-06','2026-10-05']) {
    const tested=runStrategyBacktest({strategy:fiveStrategy,candles:asCandles(makeRows(5,date+'T03:45:00Z')),request:{initialCapital:10000,useTrailingStop:false},dataSource:'LOCAL_STUB_UNDERLYING'});
    console.log(JSON.stringify({probe:'calendar_year',date,tradeCount:tested.totalTrades,error:tested.error??null,netPnl:tested.netPnl}));
  }
  const warmStrategy=structuredClone(fiveStrategy);
  warmStrategy.astConfig.indicators=[{id:'ema30',type:'EMA',period:30,source:'CLOSE'}];
  warmStrategy.astConfig.bullishEntry.conditions[0].left={type:'INDICATOR',indicatorId:'ema30'};
  const warmCandles=asCandles([...makeRows(5,'2026-10-05T03:45:00Z',75),...makeRows(5,'2026-10-06T03:45:00Z',75)]);
  const preserved=runStrategyBacktest({strategy:warmStrategy,candles:warmCandles,request:{initialCapital:10000,useTrailingStop:false}});
  const discarded=runStrategyBacktest({strategy:warmStrategy,candles:warmCandles,request:{initialCapital:10000,useTrailingStop:false,fromDate:'2026-10-06',toDate:'2026-10-06'}});
  console.log(JSON.stringify({probe:'warmup_padding_discarded',firstDay2WithWarmup:preserved.trades.find(t=>t.entryTime.startsWith('2026-10-06'))?.entryTime,firstDay2DateBounded:discarded.trades[0]?.entryTime,dateBoundedTrades:discarded.totalTrades,error:discarded.error??null}));
  const scarce=runStrategyBacktest({strategy:warmStrategy,candles:asCandles(makeRows()),request:{initialCapital:10000,useTrailingStop:false}});
  console.log(JSON.stringify({probe:'insufficient_indicator_history_success',candles:20,emaPeriod:30,trades:scarce.totalTrades,error:scarce.error??null}));
} finally {globalThis.fetch=originalFetch;Date.now=originalNow;}
