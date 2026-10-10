import { describe, it, expect } from 'vitest';
import {
  getMarketSession,
  isMarketOpenForTrading,
  isTradingHoliday,
  isWeekend,
  getMarketCalendarDetails,
} from '../market-calendar';
import { MarketSession } from '@trading-bot/contracts';

describe('Market Calendar & Trading Sessions', () => {
  it('identifies weekends as non-trading days', () => {
    // 2026-10-10 is a Saturday
    const saturday = new Date('2026-10-10T10:00:00.000Z');
    expect(isWeekend(saturday)).toBe(true);
    expect(getMarketSession(saturday)).toBe(MarketSession.WEEKEND);
    expect(isMarketOpenForTrading(saturday)).toBe(false);

    // 2026-10-11 is a Sunday
    const sunday = new Date('2026-10-11T10:00:00.000Z');
    expect(isWeekend(sunday)).toBe(true);
    expect(getMarketSession(sunday)).toBe(MarketSession.WEEKEND);
  });

  it('identifies 2026 NSE exchange holidays', () => {
    // 2026-01-26 Republic Day (Monday)
    const republicDay = new Date('2026-01-26T05:00:00.000Z'); // 10:30 IST
    const { isHoliday, holidayName } = isTradingHoliday(republicDay);
    expect(isHoliday).toBe(true);
    expect(holidayName).toBe('Republic Day');
    expect(getMarketSession(republicDay)).toBe(MarketSession.HOLIDAY);
    expect(isMarketOpenForTrading(republicDay)).toBe(false);
  });

  it('accurately identifies regular trading hours (09:15 to 15:30 IST)', () => {
    // 2026-10-14 is Wednesday (regular weekday)
    // 10:00 IST is 04:30 UTC
    const regularTradingTime = new Date('2026-10-14T04:30:00.000Z');
    expect(getMarketSession(regularTradingTime)).toBe(MarketSession.REGULAR_SESSION);
    expect(isMarketOpenForTrading(regularTradingTime)).toBe(true);

    // 09:05 IST is 03:35 UTC (Pre-open session)
    const preOpenTime = new Date('2026-10-14T03:35:00.000Z');
    expect(getMarketSession(preOpenTime)).toBe(MarketSession.PRE_OPEN);
    expect(isMarketOpenForTrading(preOpenTime)).toBe(false);

    // 16:30 IST is 11:00 UTC (Market closed)
    const marketClosedTime = new Date('2026-10-14T11:00:00.000Z');
    expect(getMarketSession(marketClosedTime)).toBe(MarketSession.MARKET_CLOSED);
    expect(isMarketOpenForTrading(marketClosedTime)).toBe(false);
  });

  it('generates complete MarketCalendarDetails payload', () => {
    const regularTradingTime = new Date('2026-10-14T04:30:00.000Z');
    const details = getMarketCalendarDetails(regularTradingTime);

    expect(details.session).toBe(MarketSession.REGULAR_SESSION);
    expect(details.isOpen).toBe(true);
    expect(details.isHoliday).toBe(false);
    expect(details.sessionStartTime).toBe('09:15:00 IST');
    expect(details.sessionEndTime).toBe('15:30:00 IST');
  });
});
