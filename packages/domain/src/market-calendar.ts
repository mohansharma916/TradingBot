import { MarketSession } from '@trading-bot/contracts';

/**
 * NSE/BSE Exchange Holidays for 2026 Calendar Year
 * Formatted as YYYY-MM-DD
 */
export const NSE_HOLIDAYS_2026: Record<string, string> = {
  '2026-01-26': 'Republic Day',
  '2026-03-03': 'Holi',
  '2026-03-20': 'Id-Ul-Fitr (Ramzan Id)',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-08-15': 'Independence Day',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali-Laxmi Pujan (Muhurat Trading excluded)',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Gurunanak Jayanti',
  '2026-12-25': 'Christmas',
};

export interface MarketCalendarDetails {
  session: MarketSession;
  isOpen: boolean;
  currentTimeIst: string;
  sessionStartTime: string;
  sessionEndTime: string;
  timeUntilOpenMs: number;
  timeUntilCloseMs: number;
  isHoliday: boolean;
  holidayName?: string;
}

/**
 * Converts any Date object to Indian Standard Time (IST - UTC+05:30)
 */
export function getIstDateTime(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  dateString: string; // YYYY-MM-DD
  timeString: string; // HH:MM:SS
} {
  // IST offset is +5.5 hours (+330 minutes)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffsetMs);

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth() + 1;
  const day = istDate.getUTCDate();
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const dayOfWeek = istDate.getUTCDay();

  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateString = `${year}-${pad(month)}-${pad(day)}`;
  const timeString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { year, month, day, hours, minutes, seconds, dayOfWeek, dateString, timeString };
}

export function isTradingHoliday(date: Date = new Date()): { isHoliday: boolean; holidayName?: string } {
  const { dateString } = getIstDateTime(date);
  const holidayName = NSE_HOLIDAYS_2026[dateString];
  return {
    isHoliday: Boolean(holidayName),
    holidayName,
  };
}

export function isWeekend(date: Date = new Date()): boolean {
  const { dayOfWeek } = getIstDateTime(date);
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

export function getMarketSession(date: Date = new Date()): MarketSession {
  if (isWeekend(date)) {
    return MarketSession.WEEKEND;
  }

  const { isHoliday } = isTradingHoliday(date);
  if (isHoliday) {
    return MarketSession.HOLIDAY;
  }

  const { hours, minutes } = getIstDateTime(date);
  const totalMinutes = hours * 60 + minutes;

  // 09:00 - 09:08 (Pre-open)
  if (totalMinutes >= 9 * 60 && totalMinutes < 9 * 60 + 8) {
    return MarketSession.PRE_OPEN;
  }

  // 09:15 - 15:30 (Regular Trading Session)
  if (totalMinutes >= 9 * 60 + 15 && totalMinutes < 15 * 60 + 30) {
    return MarketSession.REGULAR_SESSION;
  }

  // 15:40 - 16:00 (Post-close session)
  if (totalMinutes >= 15 * 60 + 40 && totalMinutes < 16 * 60) {
    return MarketSession.POST_CLOSE;
  }

  return MarketSession.MARKET_CLOSED;
}

export function isMarketOpenForTrading(date: Date = new Date()): boolean {
  return getMarketSession(date) === MarketSession.REGULAR_SESSION;
}

export function getMarketCalendarDetails(date: Date = new Date()): MarketCalendarDetails {
  const session = getMarketSession(date);
  const isOpen = session === MarketSession.REGULAR_SESSION;
  const { isHoliday, holidayName } = isTradingHoliday(date);
  const ist = getIstDateTime(date);

  const totalMinutes = ist.hours * 60 + ist.minutes;
  const openMinutes = 9 * 60 + 15;
  const closeMinutes = 15 * 60 + 30;

  const timeUntilOpenMs =
    isOpen || totalMinutes >= openMinutes
      ? 0
      : (openMinutes - totalMinutes) * 60 * 1000 - ist.seconds * 1000;

  const timeUntilCloseMs =
    !isOpen
      ? 0
      : (closeMinutes - totalMinutes) * 60 * 1000 - ist.seconds * 1000;

  return {
    session,
    isOpen,
    currentTimeIst: `${ist.dateString} ${ist.timeString} IST`,
    sessionStartTime: '09:15:00 IST',
    sessionEndTime: '15:30:00 IST',
    timeUntilOpenMs: Math.max(0, timeUntilOpenMs),
    timeUntilCloseMs: Math.max(0, timeUntilCloseMs),
    isHoliday,
    holidayName,
  };
}
