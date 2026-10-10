import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllowedOptionType, InstrumentType, StrategyConfig, TradeDirection } from '@trading-bot/contracts';
import {
  buildIndicatorCache, calculateRSI, calculateVWAP, calculateStrategyVersionHash,
  evaluateStrategyRules, evaluateStrategySignal, fetchRealHistoricalCandles, generateHistoricalMarketCandles,
  getStandardLotSize, PREDEFINED_STRATEGY_TEMPLATES, runStrategyBacktest, strategyExitLevels,
} from '../index';
import { Candle } from '../indicators';

function strategy(): StrategyConfig {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001', name:'Research fixture', version:1,
    underlying:'NIFTY',timeframe:'5m',allowedInstruments:[AllowedOptionType.LONG_CALL],
    session:{start:'09:15',lastEntry:'14:45',timezone:'Asia/Kolkata'},
    risk:{maxCapitalInr:4000,maxAllInTradeLossInr:500,maxAllInDailyLossInr:1500,maxOpenPositions:1,maxTradesPerDay:3,targetNetProfitInr:300,maxRoundTripCostBudgetInr:200},
    astConfig:{direction:TradeDirection.BULLISH,indicators:[],bullishEntry:{id:'always',operator:'AND',conditions:[{id:'signal',left:{type:'NUMBER',value:1},comparison:'GT',right:{type:'NUMBER',value:0}}]},entryRules:{allowReentry:true,cooldownBars:0},exitRules:{stopLossBasis:'OPTION_PREMIUM',stopLossValue:2,targetProfitBasis:'OPTION_PREMIUM',targetProfitValue:10,marketCutoffTime:'15:10'}},
  } as StrategyConfig;
}
function bars(count=5):Candle[] {
  return Array.from({length:count},(_,index)=>({timestamp:new Date(Date.parse('2026-10-12T03:45:00Z')+index*300000).toISOString(),open:10000,high:10000,low:10000,close:10000,volume:1000}));
}
function backtest(candles:Candle[], config=strategy(), request:any={}) {
  return runStrategyBacktest({strategy:config,candles,request:{initialCapital:10000,useTrailingStop:false,...request},dataSource:'TEST_UNDERLYING'});
}
afterEach(()=>vi.unstubAllGlobals());

describe('Strategy integrity regression gates',()=>{
  it('checks old protective stops before highs can activate a profitable trail',()=>{
    const candles=bars(); candles[4]={...candles[4]!,high:10020,low:9980};
    const result=backtest(candles,strategy(),{useTrailingStop:true,trailingActivationProfitInr:1,trailingStepInr:1});
    expect(result.trades[0]!.exitReason).toBe('STOP_LOSS');
    expect(result.trades[0]!.netPnl).toBeLessThan(0);
  });
  it('never enters before an earlier trade in the same candle has exited',()=>{
    const candles=bars(7);candles[4]={...candles[4]!,low:9990};candles[6]={...candles[6]!,low:9990};
    const result=backtest(candles);
    expect(result.trades.length).toBe(2);
    expect(Date.parse(result.trades[1]!.entryTime)).toBeGreaterThanOrEqual(Date.parse(result.trades[0]!.exitTime!));
    expect(result.trades[1]!.entryTime).not.toBe(candles[4]!.timestamp);
  });
  it('includes dataset-end losses in drawdown and timestamps settlement at bar close',()=>{
    const candles=bars(4);candles[3]={...candles[3]!,close:9999,low:9998};
    const result=backtest(candles);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.exitReason).toBe('DATASET_END');
    expect(result.netPnl).toBeLessThan(0);
    expect(result.maxDrawdown).toBeCloseTo(-result.netPnl,2);
    expect(Date.parse(result.trades[0]!.exitTime!)-Date.parse(result.trades[0]!.entryTime)).toBe(300000);
  });
  it('requires principal plus charges and spread reserve to afford a lot',()=>{
    const principal=55.05*65;
    expect(backtest(bars(),strategy(),{initialCapital:principal}).totalTrades).toBe(0);
    expect(backtest(bars(),strategy(),{initialCapital:principal}).error).toMatch(/capital/i);
  });
  it('uses configured AST targets and all-in risk instead of ignoring exit rules',()=>{
    const candles=bars();candles[4]={...candles[4]!,high:10008,close:10006};
    const small=strategy();small.astConfig!.exitRules!.targetProfitValue=2;
    const large=strategy();large.astConfig!.exitRules!.targetProfitValue=10;
    expect(backtest(candles,small).trades[0]!.exitReason).toBe('TARGET_PROFIT');
    expect(backtest(candles,large).trades[0]!.exitReason).toBe('DATASET_END');
    const expensive=strategy();expensive.astConfig!.exitRules!.stopLossValue=20;
    expect(backtest(candles,expensive).totalTrades).toBe(0);
  });
  it('honors AST cutoff and fails closed for unsupported exit bases',()=>{
    const config=strategy();config.astConfig!.exitRules!.marketCutoffTime='09:35';
    expect(backtest(bars(),config).trades[0]!.exitReason).toBe('TIME_CUTOFF');
    config.astConfig!.exitRules!.stopLossBasis='ATR_MULTIPLE';
    expect(strategyExitLevels({strategy:config,entryPrice:50,quantity:65}).error).toMatch(/not supported/);
  });
  it('labels modeled option performance even when underlying candles are genuine',()=>{
    const result=runStrategyBacktest({strategy:strategy(),candles:bars(),dataSource:'UPSTOX_HISTORICAL_UNDERLYING'});
    expect(result.dataSource).toBe('MODELED_OPTIONS_ON_UPSTOX_HISTORICAL_UNDERLYING');
    expect(result.modelAssumptions?.join(' ')).toContain('all option contracts, prices and fills are modeled');
  });
  it('fails external history acquisition without substituting synthetic data',async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error('offline'));vi.stubGlobal('fetch',fetcher);
    await expect(fetchRealHistoricalCandles({underlying:'NIFTY',fromDate:'2026-10-12',toDate:'2026-10-12'})).rejects.toThrow('No synthetic data');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('requests exact 5-minute Upstox history instead of silently returning 30-minute bars',async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:false});vi.stubGlobal('fetch',fetcher);
    await expect(fetchRealHistoricalCandles({underlying:'NIFTY',timeframe:'5m',authToken:'unit-test-placeholder'})).rejects.toThrow();
    expect(fetcher.mock.calls[0]![0]).toContain('/v3/historical-candle/NSE_INDEX%7CNifty%2050/minutes/5/');
  });
  it('hashes AST, execution mode and every risk parameter while excluding cosmetic names',()=>{
    const config=strategy();const original=calculateStrategyVersionHash(config);
    const edited=structuredClone(config);edited.astConfig!.exitRules!.stopLossValue=3;
    expect(calculateStrategyVersionHash(edited)).not.toBe(original);
    edited.astConfig!.exitRules!.stopLossValue=2;edited.risk!.maxTradesPerDay=2;
    expect(calculateStrategyVersionHash(edited)).not.toBe(original);
    expect(calculateStrategyVersionHash({...config,name:'Different label'})).toBe(original);
  });
  it('freezes the complete opening range and rejects a missing opening candle',()=>{
    const ast=PREDEFINED_STRATEGY_TEMPLATES.find(template=>template.id==='tpl_opening_range_breakout')!.astConfig;
    const candles=bars(10);candles[0]!.high=10010;for(let i=3;i<10;i++) candles[i]!.high=10100+i;
    const cache=buildIndicatorCache(candles,ast);
    expect(cache.indicatorSeries.get('high_3_bars')![2]).toBe(10010);
    expect(cache.indicatorSeries.get('high_3_bars')![9]).toBe(10010);
    expect(Number.isNaN(buildIndicatorCache(candles.slice(1),ast).indicatorSeries.get('high_3_bars')![8]!)).toBe(true);
    const closed= candles.map(c=>({...c,timestamp:new Date(Number(new Date(c.timestamp))+300000).toISOString()}));
    expect(buildIndicatorCache(closed,ast,{candleTimestampBasis:'CLOSE'}).indicatorSeries.get('high_3_bars')![9]).toBe(10010);
  });
  it('uses current lot references, rejects guessed numeric IDs, and treats zero-volume VWAP as unavailable',()=>{
    expect(getStandardLotSize('NIFTY')).toBe(65);expect(getStandardLotSize('BANKNIFTY')).toBe(30);
    expect(getStandardLotSize('NSE_FO|123456')).toBe(0);
    expect(calculateRSI(Array(20).fill(100))).toEqual(Array(6).fill(50));
    expect(Number.isNaN(calculateVWAP([{...bars(1)[0]!,volume:0}])[0]!)).toBe(true);
    expect(generateHistoricalMarketCandles('NIFTY',1,5,'2026-10-02','2026-10-02')).toHaveLength(0);
  });
  it('shares AST direction rules with runtime proposals and never substitutes a guessed contract lot',()=>{
    const config=strategy();const candles=bars();
    const quote={instrumentKey:'NSE_FO|123456',lastPrice:50,bidPrice:49.95,askPrice:50,bidQty:130,askQty:130,volume:50000,openInterest:10000,timestamp:new Date().toISOString(),isStale:false};
    const candidateInstrument={instrumentKey:quote.instrumentKey,symbol:'Test CE',underlying:'NIFTY',instrumentType:InstrumentType.CE,lotSize:65,tickSize:0.05};
    expect(evaluateStrategyRules({strategy:config,underlyingCandles:candles,candidateQuote:quote,currentTimeIst:'10:00'}).passed).toBe(false);
    expect(evaluateStrategyRules({strategy:config,underlyingCandles:candles,candidateQuote:quote,candidateInstrument,currentTimeIst:'10:00'}).passed).toBe(true);
    config.astConfig!.bullishEntry!.conditions[0] = {...config.astConfig!.bullishEntry!.conditions[0],right:{type:'NUMBER',value:2}} as any;
    expect(evaluateStrategySignal({strategy:config,candles}).bullishSignal).toBe(false);
    expect(evaluateStrategyRules({strategy:config,underlyingCandles:candles,candidateQuote:quote,candidateInstrument,currentTimeIst:'10:00'}).passed).toBe(false);
  });
});
