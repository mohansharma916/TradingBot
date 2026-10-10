import {describe,it,expect,vi,afterEach} from 'vitest';
import {getMarketSession,isMarketOpenForTrading,isCalendarVerifiedForDate,getMarketCalendarDetails} from '../market-calendar';
import {MarketSession} from '@trading-bot/contracts';
describe('verified exchange calendar',()=>{
  afterEach(()=>vi.useRealTimers());
  it('contains the omitted official weekday closures and permits the ordinary March20 session',()=>{
    for(const day of ['2026-01-15','2026-03-26','2026-03-31','2026-05-28','2026-06-26','2026-09-14']){
      expect(getMarketSession(new Date(day+'T05:00:00Z'))).toBe(MarketSession.HOLIDAY);
      expect(isMarketOpenForTrading(new Date(day+'T05:00:00Z'))).toBe(false);
    }
    expect(isMarketOpenForTrading(new Date('2026-03-20T05:00:00Z'))).toBe(true);
  });
  it('blocks a future unverified calendar and never announces a holiday or weekend opening countdown',()=>{
    const nextYear=new Date('2027-01-04T05:00:00Z');
    expect(isCalendarVerifiedForDate(nextYear)).toBe(false);
    expect(getMarketCalendarDetails(nextYear)).toMatchObject({calendarVerified:false,isOpen:false,timeUntilOpenMs:0});
    expect(getMarketCalendarDetails(new Date('2026-10-20T02:00:00Z')).timeUntilOpenMs).toBe(0);
    expect(getMarketCalendarDetails(new Date('2026-10-10T02:00:00Z')).timeUntilOpenMs).toBe(0);
  });
});
