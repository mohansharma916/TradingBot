import {describe,it,expect,vi} from 'vitest';
import {MarketsController} from '../markets/markets.controller';
describe('public market chain provenance',()=>{
  it('returns unavailable zero spot instead of a seeded underlying level',()=>{
    const catalog={buildOptionChain:vi.fn((underlying,expiry,spot)=>({underlying,expiry,spotPrice:spot}))};
    const controller=new MarketsController({getQuote:()=>undefined} as any,catalog as any);
    expect(controller.getOptionChain('NIFTY').spotPrice).toBe(0);
    expect(controller.getOptionChain('BANKNIFTY').spotPrice).toBe(0);
  });
  it('forwards observed quote provenance, depth and timestamp and selects the correct FINNIFTY underlying',()=>{
    const feed={getQuote:vi.fn((key)=>({instrumentKey:key,lastPrice:100,provenance:'LIVE',depthKnown:true,timestamp:new Date().toISOString(),isStale:false}))};
    let quoted:any;
    const catalog={buildOptionChain:vi.fn((underlying,expiry,spot,lookup)=>{quoted=lookup('NSE_FO|52175');return {spotPrice:spot};})};
    new MarketsController(feed as any,catalog as any).getOptionChain('FINNIFTY');
    expect(feed.getQuote.mock.calls[0]?.[0]).toBe('NSE_INDEX|Nifty Fin Service');
    expect(quoted).toMatchObject({provenance:'LIVE',depthKnown:true,isStale:false});
    expect(quoted.timestamp).toBeTruthy();
  });
});
