import '../../apps/api/node_modules/reflect-metadata/Reflect.js';
import { createRequire } from 'node:module';
import { StrategiesService } from '../../apps/api/src/strategies/strategies.service.ts';
import { StrategiesController } from '../../apps/api/src/strategies/strategies.controller.ts';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const express = createRequire(require.resolve('@nestjs/platform-express'))('express');
const rows=Array.from({length:20},(_,i)=>[new Date(Date.parse('2026-10-05T03:45:00Z')+i*900000).toISOString(),10000+i,10002+i,9999+i,10001+i,1000,0]);
const strategy:any={id:'550e8400-e29b-41d4-a716-446655440001',name:'History probe',version:1,underlying:'NIFTY',timeframe:'15m',allowedInstruments:['LONG_CALL'],session:{start:'09:15',lastEntry:'14:45',timezone:'Asia/Kolkata'},risk:{maxCapitalInr:4000,maxAllInTradeLossInr:500,maxAllInDailyLossInr:1500,maxOpenPositions:1,maxTradesPerDay:3,targetNetProfitInr:300,maxRoundTripCostBudgetInr:200},astConfig:{direction:'BULLISH',indicators:[],bullishEntry:{id:'always',operator:'AND',conditions:[{id:'signal',left:{type:'NUMBER',value:1},comparison:'GT',right:{type:'NUMBER',value:0}}]},entryRules:{allowReentry:true,cooldownBars:0},exitRules:{stopLossBasis:'OPTION_PREMIUM',stopLossValue:2,targetProfitBasis:'OPTION_PREMIUM',targetProfitValue:10,marketCutoffTime:'15:10'}}};
const originalFetch=globalThis.fetch;
const calls:string[]=[];
try {
  globalThis.fetch=(async(input:any)=>{calls.push(String(input));return {ok:true,json:async()=>({status:'success',data:{candles:rows}})} as any;}) as any;
  const service:any=Object.create(StrategiesService.prototype);
  service.getStrategy=()=>strategy;
  service.tokens={hasValidToken:()=>true,getToken:()=>({accessToken:'fake-local-probe-token'})};
  const result=await service.runBacktest(strategy.id,{fromDate:'2026-10-05',toDate:'2026-10-05',initialCapital:10000,useTrailingStop:false});
  console.log(JSON.stringify({probe:'actual_api_service_timeframe',url:calls[0],timeframe:result.timeframe,trades:result.totalTrades,netPnl:result.netPnl,error:result.error??null,lastExit:result.trades.at(-1)?.exitTime}));
  const matched:string[]=[];
  const router=express.Router();
  const paths:string[]=[];
  for(const key of Object.getOwnPropertyNames(StrategiesController.prototype)) {
    const handler=(StrategiesController.prototype as any)[key];
    if(typeof handler!=='function'||Reflect.getMetadata('method',handler)!==1) continue;
    const path=Reflect.getMetadata('path',handler);
    paths.push(path);
    router.post('/strategies/'+path,(req:any,res:any)=>{matched.push(key+':'+(req.params.id??''));});
  }
  router.handle({method:'POST',url:'/strategies/price-action-momentum/backtest',headers:{}},{},()=>{});
  console.log(JSON.stringify({probe:'in_process_express_route_match_using_actual_controller_metadata',routeOrder:paths,matched}));
}finally{globalThis.fetch=originalFetch;}
