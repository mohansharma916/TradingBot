import { MarketSession } from '@trading-bot/contracts';

/**
 * NSE F&O holiday calendar for 2023, 2024, 2025, and 2026.
 * Sources: Official NSE Circulars & Exchange Communications
 * Formatted as YYYY-MM-DD
 */
export const NSE_HOLIDAYS_2023: Record<string, string> = {
  '2023-01-26': 'Republic Day',
  '2023-03-07': 'Holi',
  '2023-03-30': 'Ram Navami',
  '2023-04-04': 'Shri Mahavir Jayanti',
  '2023-04-07': 'Good Friday',
  '2023-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2023-05-01': 'Maharashtra Day',
  '2023-06-28': 'Bakri Id',
  '2023-08-15': 'Independence Day',
  '2023-09-19': 'Ganesh Chaturthi',
  '2023-10-02': 'Mahatma Gandhi Jayanti',
  '2023-10-24': 'Dussehra',
  '2023-11-14': 'Diwali Balipratipada',
  '2023-11-27': 'Gurunanak Jayanti',
  '2023-12-25': 'Christmas',
};

export const NSE_HOLIDAYS_2024: Record<string, string> = {
  '2024-01-22': 'Ram Mandir Pran Pratishtha',
  '2024-01-26': 'Republic Day',
  '2024-03-08': 'Mahashivratri',
  '2024-03-25': 'Holi',
  '2024-03-29': 'Good Friday',
  '2024-04-11': 'Id-Ul-Fitr (Ramadan Eid)',
  '2024-04-17': 'Shri Ram Navami',
  '2024-05-01': 'Maharashtra Day',
  '2024-05-20': 'General Elections - Mumbai',
  '2024-06-17': 'Bakri Id',
  '2024-07-17': 'Moharram',
  '2024-08-15': 'Independence Day',
  '2024-10-02': 'Mahatma Gandhi Jayanti',
  '2024-11-01': 'Diwali-Laxmi Pujan (Muhurat Trading excluded)',
  '2024-11-15': 'Gurunanak Jayanti',
  '2024-11-20': 'Maharashtra Assembly Elections',
  '2024-12-25': 'Christmas',
};

export const NSE_HOLIDAYS_2025: Record<string, string> = {
  '2025-02-26': 'Mahashivratri',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-Ul-Fitr (Ramadan Eid)',
  '2025-04-10': 'Shri Mahavir Jayanti',
  '2025-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Maharashtra Day',
  '2025-08-15': 'Independence Day',
  '2025-08-27': 'Ganesh Chaturthi',
  '2025-10-02': 'Mahatma Gandhi Jayanti/Dussehra',
  '2025-10-21': 'Diwali-Laxmi Pujan (Muhurat Trading excluded)',
  '2025-10-22': 'Diwali Balipratipada',
  '2025-11-05': 'Gurunanak Jayanti',
  '2025-12-25': 'Christmas',
};

export const NSE_HOLIDAYS_2026: Record<string, string> = {
  '2026-01-15': 'Municipal Corporation Election - Maharashtra',
  '2026-01-26': 'Republic Day',
  '2026-03-03': 'Holi',
  '2026-03-21': 'Id-Ul-Fitr (Ramadan Eid)',
  '2026-03-26': 'Shri Ram Navami',
  '2026-03-31': 'Shri Mahavir Jayanti',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-28': 'Bakri Id',
  '2026-06-26': 'Muharram',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-08-15': 'Independence Day',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali-Laxmi Pujan (Muhurat Trading excluded)',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Gurunanak Jayanti',
  '2026-12-25': 'Christmas',
};

export const NSE_ALL_HOLIDAYS: Record<number, Record<string, string>> = {
  2023: NSE_HOLIDAYS_2023,
  2024: NSE_HOLIDAYS_2024,
  2025: NSE_HOLIDAYS_2025,
  2026: NSE_HOLIDAYS_2026,
};

export const SUPPORTED_CALENDAR_YEARS = [2023, 2024, 2025, 2026] as const;

export interface SpecialTradingSession {
  date: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
}

export const NSE_SPECIAL_SESSIONS: Record<string, SpecialTradingSession> = {
  '2023-11-12': { date: '2023-11-12', name: 'Muhurat Trading 2023', startMinutes: 18 * 60 + 15, endMinutes: 19 * 60 + 15 },
  '2024-03-02': { date: '2024-03-02', name: 'Special Live Trading Session (DR)', startMinutes: 9 * 60 + 15, endMinutes: 12 * 60 + 30 },
  '2024-05-18': { date: '2024-05-18', name: 'Special Live Trading Session (DR)', startMinutes: 9 * 60 + 15, endMinutes: 12 * 60 + 30 },
  '2024-11-01': { date: '2024-11-01', name: 'Muhurat Trading 2024', startMinutes: 18 * 60, endMinutes: 19 * 60 },
  '2025-10-21': { date: '2025-10-21', name: 'Muhurat Trading 2025', startMinutes: 18 * 60 + 15, endMinutes: 19 * 60 + 15 },
  '2026-11-08': { date: '2026-11-08', name: 'Muhurat Trading 2026', startMinutes: 18 * 60 + 15, endMinutes: 19 * 60 + 15 },
};

export interface MarketCalendarDetails {
  calendarVerified: boolean;
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
  const { dateString, year } = getIstDateTime(date);
  const holidayMap = NSE_ALL_HOLIDAYS[year] ?? NSE_HOLIDAYS_2026;
  const holidayName = holidayMap[dateString];
  return {
    isHoliday: Boolean(holidayName),
    holidayName,
  };
}

/** Do not treat an unmaintained future or past holiday calendar outside 2023-2026 as permission to trade. */
export function isCalendarVerifiedForDate(date: Date = new Date()): boolean {
  return (SUPPORTED_CALENDAR_YEARS as readonly number[]).includes(getIstDateTime(date).year);
}

export function isWeekend(date: Date = new Date()): boolean {
  const { dayOfWeek } = getIstDateTime(date);
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

export function getMarketSession(date: Date = new Date()): MarketSession {
  if (!isCalendarVerifiedForDate(date)) return MarketSession.MARKET_CLOSED;

  const { hours, minutes, dateString } = getIstDateTime(date);
  const totalMinutes = hours * 60 + minutes;

  // Special trading sessions (e.g. Muhurat trading)
  const special = NSE_SPECIAL_SESSIONS[dateString];
  if (special) {
    if (totalMinutes >= special.startMinutes && totalMinutes < special.endMinutes) {
      return MarketSession.REGULAR_SESSION;
    }
  }

  if (isWeekend(date)) {
    return MarketSession.WEEKEND;
  }

  const { isHoliday } = isTradingHoliday(date);
  if (isHoliday) {
    return MarketSession.HOLIDAY;
  }

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
    !isCalendarVerifiedForDate(date) || isWeekend(date) || isHoliday || isOpen || totalMinutes >= openMinutes
      ? 0
      : (openMinutes - totalMinutes) * 60 * 1000 - ist.seconds * 1000;

  const timeUntilCloseMs =
    !isOpen
      ? 0
      : (closeMinutes - totalMinutes) * 60 * 1000 - ist.seconds * 1000;

  return {
    calendarVerified: isCalendarVerifiedForDate(date),
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
