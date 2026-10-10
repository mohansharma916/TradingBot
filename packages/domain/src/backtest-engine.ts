import { AllowedOptionType, BacktestRequest, BacktestResult, BacktestTradeRecord, StrategyConfig, TrailingProfitMode } from '@trading-bot/contracts';
import { calculateOptionCharges } from './charges';
import { Candle } from './indicators';
import { getStandardLotSize } from './lot-size';
import { buildIndicatorCache, convertLegacyStrategyToAst, evaluateStrategyAst } from './strategy-rule-evaluator';
import { strategyExitLevels, strategyTimeframeMinutes } from './strategy-evaluator';
import { isMarketOpenForTrading } from './market-calendar';

export interface BacktestOptions { strategy: StrategyConfig; candles: Candle[]; request?: Partial<BacktestRequest>; dataSource?: string; lotSize?: number; tickSize?: number }
const iso = (time: string | number) => new Date(time).toISOString();
const money = (value:number) => Number(value.toFixed(2));
const istTime = (timestamp:string | number) => new Date(Number(new Date(timestamp)) + 330 * 60000).toISOString().slice(11,16);
/** Research simulation of option premiums from underlying candles; never historical option fills. */
export function runStrategyBacktest(options:BacktestOptions):BacktestResult {
  const {strategy,request} = options;
  const lotSize = options.lotSize ?? getStandardLotSize(strategy.underlying);
  const tickSize = options.tickSize ?? 0.05;
  const timeframe = request?.timeframe ?? strategy.timeframe ?? '5m';
  const interval = strategyTimeframeMinutes(timeframe) * 60000;
  const initialCapital = request?.initialCapital ?? strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? 10000;
  const source = options.dataSource ?? 'CALLER_SUPPLIED_UNVERIFIED_CANDLES';
  const dataSource = `MODELED_OPTIONS_ON_${source}`;
  const modelAssumptions = ['Underlying candles are input data; all option contracts, prices and fills are modeled.', 'ATM premium = 0.55% of spot, fixed delta = 0.5; IV, theta, expiry and real option depth are absent.', 'One tick each side models spread; intrabar stops precede targets and trailing updates only after the bar closes.', 'Current fee rates are estimates; simulated performance does not establish a profitable trading edge.'];
  let candles = [...(options.candles ?? [])].sort((a,b)=>Number(new Date(a.timestamp))-Number(new Date(b.timestamp)));
  if (request?.fromDate || request?.toDate) {
    const dates = [(request.fromDate ?? request.toDate)!.slice(0,10),(request.toDate ?? request.fromDate)!.slice(0,10)].sort();
    const start = Date.parse(`${dates[0]}T00:00:00+05:30`), end = Date.parse(`${dates[1]}T23:59:59.999+05:30`);
    candles = candles.filter(c=>Number(new Date(c.timestamp))>=start && Number(new Date(c.timestamp))<=end);
  }
  const fromDate = candles[0] ? iso(candles[0].timestamp) : new Date().toISOString();
  const toDate = candles.at(-1) ? iso(candles.at(-1)!.timestamp) : fromDate;
  const empty:BacktestResult = {strategyId:strategy.id,strategyName:strategy.name,version:strategy.version,periodDays:Math.max(1,Math.ceil((Date.parse(toDate)-Date.parse(fromDate))/86400000)),timeframe,fromDate,toDate,dataSource,modelAssumptions,initialCapital,finalCapital:initialCapital,totalTrades:0,winningTrades:0,losingTrades:0,winRatePct:0,grossPnl:0,totalCharges:0,netPnl:0,maxDrawdown:0,maxDrawdownPct:0,profitFactor:0,trades:[]};
  if (!Number.isInteger(lotSize) || lotSize<=0 || !Number.isFinite(tickSize) || tickSize<=0 || !interval || !Number.isFinite(initialCapital) || initialCapital<=0) return {...empty,error:'Valid timeframe, capital and authoritative lot/tick metadata are required.'};
  if (candles.some((c,i)=>!Number.isFinite(Number(new Date(c.timestamp))) || ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low<=0 || c.high<Math.max(c.open,c.close) || c.low>Math.min(c.open,c.close) || c.volume<0 || (i>0 && Number(new Date(c.timestamp))===Number(new Date(candles[i-1]!.timestamp))))) return {...empty,error:'Invalid or duplicate underlying candles.'};
  if (candles.length<3) return empty;
  if (interval >= 86400000) return {...empty,error:'This intraday premium model requires intraday candles; daily bars cannot determine session entry and exits.'};
  const minimumPremium=Math.min(...candles.map(c=>money(Math.max(25,c.open*0.0055)+tickSize)));
  const minimumCharges=calculateOptionCharges({buyPrice:minimumPremium,sellPrice:minimumPremium,quantity:lotSize}).totalRoundTripCharges;
  if (initialCapital<minimumPremium*lotSize+minimumCharges+2*tickSize*lotSize) return {...empty,error:'Insufficient capital for one reference lot including estimated round-trip charges and spread reserve.'};
  const ast = convertLegacyStrategyToAst(strategy);
  if ((ast.indicators ?? []).some(ind=>ind.timeframe && ind.timeframe!==timeframe)) return {...empty,error:'Mixed indicator timeframes are unsupported; aligned source data is required.'};
  if (ast.contractSelection?.instrumentType==='FUTURES' || ast.exitRules?.exitOnIndicatorReversal) return {...empty,error:'Futures and generic indicator-reversal exits require a dedicated price/execution model.'};
  const useTrailing = request?.useTrailingStop ?? ast.trailingProfit?.enabled ?? false;
  if (useTrailing && ast.trailingProfit?.mode && ast.trailingProfit.mode!==TrailingProfitMode.FIXED_STEP) return {...empty,error:'Only fixed-step trailing is supported by this modeled backtest.'};
  const cache = buildIndicatorCache(candles,ast,{timeframeMinutes:interval/60000,candleTimestampBasis:'OPEN'});
  const maxDaily = Math.min(request?.maxDailyLossInr ?? Infinity,strategy.risk?.maxAllInDailyLossInr ?? strategy.maxAllInDailyLossInr ?? 600);
  const maxTrade = Math.min(request?.maxTradeLossInr ?? Infinity,strategy.risk?.maxAllInTradeLossInr ?? strategy.maxAllInTradeLossInr ?? 500);
  const maxTrades = Math.min(request?.maxTradesPerDay ?? Infinity,strategy.risk?.maxTradesPerDay ?? 3);
  const maxCapital = strategy.risk?.maxCapitalInr ?? strategy.maxCapitalInr ?? initialCapital;
  const cutoff = ast.exitRules?.marketCutoffTime ?? strategy.exit?.marketCutoff ?? '15:10';
  const activation = request?.trailingActivationProfitInr ?? ast.trailingProfit?.activationProfitInr ?? 150;
  const gap = request?.trailingStepInr ?? ast.trailingProfit?.trailingGapInr ?? ast.trailingProfit?.adjustmentStepInr ?? 50;
  const trades:BacktestTradeRecord[]=[];
  let capital=initialCapital,peak=initialCapital,drawdown=0,drawdownPct=0,day='',dailyPnl=0,count=0,lastExitIndex=-Infinity,lastEntrySignal=false;
  let active: {entryIndex:number;entryTime:string;entry:number;premium:number;spot:number;quantity:number;stop:number;initialStop:number;target:number;type:'CE'|'PE';trailing:boolean;peakClose:number} | null=null;
  const prices=(c:Candle)=>{
    const t=active!; const sign=t.type==='CE'?1:-1;
    const premium=(spot:number)=>Math.max(tickSize,t.premium+sign*(spot-t.spot)*0.5-tickSize);
    return {open:premium(c.open),high:premium(t.type==='CE'?c.high:c.low),low:premium(t.type==='CE'?c.low:c.high),close:premium(c.close)};
  };
  const settle=(price:number,timestamp:string,reason:string,index:number)=>{
    const t=active!;const grossPnl=money((price-t.entry)*t.quantity);
    const charges=calculateOptionCharges({buyPrice:t.entry,sellPrice:price,quantity:t.quantity}).totalRoundTripCharges;
    const netPnl=money(grossPnl-charges);capital=money(capital+netPnl);dailyPnl=money(dailyPnl+netPnl);
    peak=Math.max(peak,capital);drawdown=Math.max(drawdown,peak-capital);drawdownPct=Math.max(drawdownPct,peak>0?(peak-capital)/peak*100:0);
    trades.push({id:`bt_${trades.length+1}`,entryTime:t.entryTime,exitTime:timestamp,durationMinutes:Math.max(0,(Date.parse(timestamp)-Date.parse(t.entryTime))/60000),symbol:`${strategy.underlying} MODELED ATM ${t.type}`,side:'BUY',entryPrice:t.entry,exitPrice:money(price),quantity:t.quantity,grossPnl,charges,netPnl,exitReason:reason,initialStopPrice:t.initialStop,trailingStopPrice:t.trailing?t.stop:undefined});
    active=null;lastExitIndex=index;
  };
  const protect=(c:Candle,index:number)=>{
    if (!active) return;
    const p=prices(c);const closeTime=new Date(Number(new Date(c.timestamp))+interval).toISOString();
    // Only a stop established BEFORE this bar may trigger on this bar's extremes.
    if (p.low<=active.stop) {settle(Math.min(active.stop,p.open),closeTime,active.trailing?'TRAILING_STOP_LOSS':'STOP_LOSS',index);return;}
    if (p.high>=active.target) {settle(active.target,closeTime,'TARGET_PROFIT',index);return;}
    if (ast.exitRules?.maxHoldingBars && index-active.entryIndex+1>=ast.exitRules.maxHoldingBars) {settle(p.close,closeTime,'MAX_HOLDING_BARS',index);return;}
    if (useTrailing) {
      active.peakClose=Math.max(active.peakClose,p.close);
      const netPeak=(active.peakClose-active.entry)*active.quantity-calculateOptionCharges({buyPrice:active.entry,sellPrice:active.peakClose,quantity:active.quantity}).totalRoundTripCharges;
      if (netPeak>=activation) {active.trailing=true;active.stop=Math.max(active.stop,Math.floor((active.peakClose-gap/active.quantity)/tickSize+1e-9)*tickSize);}
    }
  };
  for (let i=0;i<candles.length;i++) {
    const c=candles[i]!;const currentDay=iso(c.timestamp).slice(0,10);
    if (currentDay!==day) {
      if (active && i>0) {const prev=candles[i-1]!;settle(prices(prev).close,new Date(Number(new Date(prev.timestamp))+interval).toISOString(),'SESSION_DATA_END',i-1);}
      day=currentDay;dailyPnl=0;count=0;lastEntrySignal=false;
    }
    if (!isMarketOpenForTrading(new Date(c.timestamp))) continue;
    const time=istTime(c.timestamp);
    const evaluated=i>0?evaluateStrategyAst(ast,i-1,candles,cache):{bullishSignal:false,bearishSignal:false,isWarmedUp:false};
    const bullish=evaluated.bullishSignal && !evaluated.bearishSignal;
    const bearish=evaluated.bearishSignal && !evaluated.bullishSignal;
    const hasSignal=bullish||bearish;
    if (active) {
      const opposite=active.type==='CE'?bearish:bullish;
      if (time>=cutoff || ast.exitRules?.exitOnOppositeSignal && opposite) settle(prices(c).open,iso(c.timestamp),time>=cutoff?'TIME_CUTOFF':'OPPOSITE_SIGNAL',i);
      else protect(c,i);
    }
    if (active || lastExitIndex===i) {lastEntrySignal=hasSignal;continue;}
    if (!hasSignal || !evaluated.isWarmedUp || time<(strategy.session?.start ?? '09:25') || time>(strategy.session?.lastEntry ?? '14:45') || time>=cutoff || count>=maxTrades || dailyPnl<=-maxDaily || i-lastExitIndex<=(ast.entryRules?.cooldownBars ?? 0) || ast.entryRules?.allowReentry===false && lastEntrySignal) {lastEntrySignal=hasSignal;continue;}
    lastEntrySignal=hasSignal;
    const type=bullish?'CE':'PE';
    if (strategy.allowedInstruments && !strategy.allowedInstruments.includes(type==='CE'?AllowedOptionType.LONG_CALL:AllowedOptionType.LONG_PUT)) continue;
    if (ast.contractSelection?.optionSide==='LONG_CE' && type!=='CE' || ast.contractSelection?.optionSide==='LONG_PE' && type!=='PE') continue;
    const premium=money(Math.max(25,c.open*0.0055));const entry=money(premium+tickSize);
    if (entry<(ast.contractSelection?.minPremium ?? 0) || entry>(ast.contractSelection?.maxPremium ?? Infinity)) continue;
    let lots=Math.floor(Math.min(maxCapital,capital)/(entry*lotSize));
    let selected: {quantity:number;stop:number;target:number}|undefined;
    while(lots>=1) {
      const quantity=lots*lotSize;
      const adjusted:StrategyConfig={...strategy,risk:{...strategy.risk,maxAllInTradeLossInr:Math.min(maxTrade,maxDaily+dailyPnl)} as StrategyConfig['risk']};
      const levels=strategyExitLevels({strategy:adjusted,entryPrice:entry,quantity,slippageBufferInr:2*tickSize*quantity,tickSize});
      if (levels.error || levels.stopPrice===undefined || levels.targetPrice===undefined) {lots--;continue;}
      const charges=Math.max(calculateOptionCharges({buyPrice:entry,sellPrice:levels.stopPrice,quantity}).totalRoundTripCharges,calculateOptionCharges({buyPrice:entry,sellPrice:levels.targetPrice,quantity}).totalRoundTripCharges);
      const allIn=(entry-levels.stopPrice)*quantity+calculateOptionCharges({buyPrice:entry,sellPrice:levels.stopPrice,quantity}).totalRoundTripCharges+2*tickSize*quantity;
      const reserve=entry*quantity+charges+2*tickSize*quantity;
      if (reserve<=Math.min(maxCapital,capital) && allIn<=Math.min(maxTrade,maxDaily+dailyPnl) && charges<=(strategy.risk?.maxRoundTripCostBudgetInr ?? strategy.maxRoundTripCostBudgetInr ?? Infinity)) {selected={quantity,stop:levels.stopPrice,target:levels.targetPrice};break;}
      lots--;
    }
    if (!selected) continue;
    active={entryIndex:i,entryTime:iso(c.timestamp),entry,premium,spot:c.open,quantity:selected.quantity,stop:selected.stop,initialStop:selected.stop,target:selected.target,type,trailing:false,peakClose:entry};count++;
    protect(c,i);
  }
  if (active && candles.at(-1)) {const last=candles.at(-1)!;settle(prices(last).close,new Date(Number(new Date(last.timestamp))+interval).toISOString(),'DATASET_END',candles.length-1);}
  const totalCharges=money(trades.reduce((sum,t)=>sum+t.charges,0));const grossPnl=money(trades.reduce((sum,t)=>sum+t.grossPnl,0));
  const wins=trades.filter(t=>t.netPnl>0);const losses=trades.filter(t=>t.netPnl<=0);const gains=wins.reduce((sum,t)=>sum+t.netPnl,0);const loss=Math.abs(losses.reduce((sum,t)=>sum+t.netPnl,0));
  return {...empty,finalCapital:capital,totalTrades:trades.length,winningTrades:wins.length,losingTrades:losses.length,winRatePct:trades.length?money(wins.length/trades.length*100):0,grossPnl,totalCharges,netPnl:money(grossPnl-totalCharges),maxDrawdown:money(drawdown),maxDrawdownPct:money(drawdownPct),profitFactor:loss?money(gains/loss):0,trades};
}

/**
 * Fetches historical underlying candles from named external providers; unavailable data fails closed.
 * Supports Yahoo Finance chart API for NIFTY (^NSEI) and BANKNIFTY (^NSEBANK),
 * or Upstox historical-candle API when authenticated.
 */
export async function fetchRealHistoricalCandles(options: {
  underlying: string;
  timeframe?: string;
  interval?: string;
  days?: number;
  fromDate?: string;
  toDate?: string;
  authToken?: string;
}): Promise<{ candles: Candle[]; dataSource: string }> {
  const { underlying, days = 14, fromDate, toDate, authToken } = options;
  const requestedTf = options.timeframe || options.interval || '5m';
  const upperUnderlying = underlying.toUpperCase();
  const yahooSymbol = upperUnderlying === 'BANKNIFTY' ? '%5ENSEBANK' : '%5ENSEI';
  const interval = ['1m', '5m', '15m', '30m', '1d'].includes(requestedTf) ? requestedTf : '5m';

  const rawFrom = fromDate || toDate;
  const rawTo = toDate || fromDate;
  const isCustom = Boolean(rawFrom || rawTo);

  let startMs: number;
  let endMs: number;

  if (isCustom) {
    const f1 = rawFrom!.slice(0, 10);
    const t1 = rawTo!.slice(0, 10);
    const [fromDay, toDay] = f1 <= t1 ? [f1, t1] : [t1, f1];
    startMs = new Date(`${fromDay}T00:00:00+05:30`).getTime();
    endMs = new Date(`${toDay}T23:59:59.999+05:30`).getTime();
  } else {
    endMs = Date.now();
    startMs = endMs - days * 86400000;
  }

  // 1. Try Upstox Historical Candle API if token available
  if (authToken) {
    try {
      const upstoxInstrumentKey = upperUnderlying === 'BANKNIFTY' ? 'NSE_INDEX|Nifty Bank' : 'NSE_INDEX|Nifty 50';
      const toStr = new Date(endMs).toISOString().slice(0, 10);
      const fromStr = new Date(startMs).toISOString().slice(0, 10);
      const upstoxInterval = interval === '1d' ? 'days/1' : `minutes/${strategyTimeframeMinutes(interval)}`;
      const res = await fetch(
        `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(upstoxInstrumentKey)}/${upstoxInterval}/${toStr}/${fromStr}`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' } },
      );
      if (res.ok) {
        const json = (await res.json()) as any;
        const candlesRaw = json?.data?.candles;
        if (Array.isArray(candlesRaw) && candlesRaw.length > 5) {
          const parsedCandles: Candle[] = candlesRaw
            .map((c: any[]) => ({
              timestamp: c[0],
              open: Number(c[1]),
              high: Number(c[2]),
              low: Number(c[3]),
              close: Number(c[4]),
              volume: Number(c[5] ?? 0),
            }))
            .filter((c) => {
              const tMs = new Date(c.timestamp).getTime();
              return tMs >= startMs && tMs <= endMs;
            })
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          if (parsedCandles.length >= 10) {
            return { candles: parsedCandles, dataSource: 'UPSTOX_HISTORICAL_UNDERLYING' };
          }
        }
      }
    } catch {
      // Fall through to Yahoo
    }
  }

  // 2. Fetch from Yahoo Finance Chart Feed (Real NSE Exchange Data)
  try {
    let url = '';
    if (isCustom) {
      const period1 = Math.floor(startMs / 1000);
      const period2 = Math.floor(endMs / 1000);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&period1=${period1}&period2=${period2}`;
    } else {
      const range = days <= 7 ? '7d' : days <= 14 ? '14d' : days <= 30 ? '1mo' : '60d';
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
    }

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const data = (await res.json()) as any;
      const result = data?.chart?.result?.[0];
      const timestamps: number[] = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0];

      if (timestamps.length > 5 && quote?.open && quote?.close) {
        const candles: Candle[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          const tMs = timestamps[i]! * 1000;
          // Filter strictly within the requested time bounds
          if (tMs < startMs || tMs > endMs) {
            continue;
          }
          const o = quote.open[i];
          const h = quote.high[i];
          const l = quote.low[i];
          const c = quote.close[i];
          const v = quote.volume[i] ?? 0;
          if (o !== null && h !== null && l !== null && c !== null && !isNaN(o) && !isNaN(c)) {
            candles.push({
              timestamp: new Date(tMs).toISOString(),
              open: Number(Number(o).toFixed(2)),
              high: Number(Number(h).toFixed(2)),
              low: Number(Number(l).toFixed(2)),
              close: Number(Number(c).toFixed(2)),
              volume: Number(v),
            });
          }
        }
        if (candles.length >= 10) {
          return { candles, dataSource: 'YAHOO_UNDERLYING_CANDLES' };
        }
      }
    }
  } catch {
    // Network offline fallback
  }

  throw new Error('Historical underlying data is unavailable from the configured providers. No synthetic data was substituted.');
}

/** Explicit deterministic test/demo fixture generator. These are synthetic candles, never fetched market history. */
export function generateHistoricalMarketCandles(underlying:string,days=14,timeframeMinutes=5,fromDate?:string,toDate?:string):Candle[] {
  if (!Number.isInteger(timeframeMinutes) || timeframeMinutes<=0 || timeframeMinutes>375) return [];
  const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  const end=(toDate ?? fromDate ?? today).slice(0,10);
  const start=(fromDate ?? toDate ?? new Date(Date.parse(`${today}T00:00:00Z`)-days*86400000).toISOString().slice(0,10)).slice(0,10);
  const [first,last]=[start,end].sort();
  let seed=2166136261;for(const character of `${underlying}:${first}:${last}:${timeframeMinutes}`) seed=Math.imul(seed^character.charCodeAt(0),16777619);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const candles:Candle[]=[];let price=underlying==='BANKNIFTY'?55256.65:22520.45;
  for(let day=Date.parse(`${first}T03:45:00Z`);day<=Date.parse(`${last}T03:45:00Z`);day+=86400000){
    if(!isMarketOpenForTrading(new Date(day))) continue;
    for(let bar=0;bar<Math.floor(375/timeframeMinutes);bar++){
      const volatility=underlying==='BANKNIFTY'?42:18;
      const open=money(price);price+=Math.sin(bar/18*Math.PI*2)*volatility*0.7+(random()-0.49)*volatility*1.1;
      const close=money(price);candles.push({timestamp:new Date(day+bar*timeframeMinutes*60000).toISOString(),open,close,high:money(Math.max(open,close)+random()*volatility*0.5),low:money(Math.min(open,close)-random()*volatility*0.5),volume:Math.floor(15000+random()*35000)});
    }
  }
  return candles;
}
