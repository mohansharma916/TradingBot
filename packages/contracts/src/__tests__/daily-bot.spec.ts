import { describe, expect, it } from 'vitest';
import { DailyBotCloneRequestSchema, DailyBotConfigSchema, DailyBotTradingDateSchema, TradeMode } from '../index';

const config = {
  name: 'Morning NIFTY',
  tradingDate: '2026-10-12',
  dailyCapitalBudget: 10000,
  dailyMaxLossAllIn: 600,
  perTradeMaxLossAllIn: 200,
  maxCapitalPerTrade: 5000,
  strategyId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('Daily Trading Bot configuration', () => {
  it('resolves paper trading and protection defaults', () => {
    expect(DailyBotConfigSchema.parse({ ...config, name: '  Morning NIFTY  ' })).toMatchObject({
      name: 'Morning NIFTY',
      tradingMode: TradeMode.PAPER,
      maximumConcurrentPositions: 1,
      maximumTradesPerDay: 3,
      minNetProfitToActivateTrailing: 300,
      desiredNetProfitLock: 100,
      trailingAlgorithm: 'STEP_LOCK',
      trailingStepProfit: 100,
      trailingStepLock: 50,
      trailingPercent: 5,
      maxRoundTripCharges: 60,
      entryStartTime: '09:25',
      lastEntryTime: '14:45',
      mandatoryExitTime: '15:10',
    });
  });

  it.each([
    { dailyCapitalBudget: 10001 },
    { dailyMaxLossAllIn: 1501 },
    { perTradeMaxLossAllIn: 501 },
    { dailyCapitalBudget: 500, dailyMaxLossAllIn: 600 },
    { dailyMaxLossAllIn: 100, perTradeMaxLossAllIn: 200 },
    { maxCapitalPerTrade: 10001 },
    { dailyCapitalBudget: 1000, maxCapitalPerTrade: 1001 },
    { maximumConcurrentPositions: 2 },
    { maximumTradesPerDay: 0 },
    { maximumTradesPerDay: 21 },
    { maximumTradesPerDay: 1.5 },
    { dailyCapitalBudget: Infinity },
  ])('rejects account or daily budget violations: %j', (change) => {
    expect(DailyBotConfigSchema.safeParse({ ...config, ...change }).success).toBe(false);
  });

  it.each([
    { desiredNetProfitLock: 300 },
    { desiredNetProfitLock: -1 },
    { minNetProfitToActivateTrailing: 0 },
    { trailingStepProfit: 0 },
    { trailingStepLock: 0 },
    { trailingPercent: 31 },
    { maxRoundTripCharges: 0 },
    { dailyNetProfitObjective: 0 },
  ])('rejects invalid profit protection settings: %j', (change) => {
    expect(DailyBotConfigSchema.safeParse({ ...config, ...change }).success).toBe(false);
  });

  it.each([
    { entryStartTime: '9:25' },
    { entryStartTime: '09:14' },
    { lastEntryTime: '09:25' },
    { mandatoryExitTime: '14:45' },
    { mandatoryExitTime: '15:31' },
    { lastEntryTime: '15:60' },
  ])('rejects invalid or unordered IST trading windows: %j', (change) => {
    expect(DailyBotConfigSchema.safeParse({ ...config, ...change }).success).toBe(false);
  });

  it('accepts market session boundaries and a zero initial profit lock', () => {
    expect(DailyBotConfigSchema.safeParse({
      ...config,
      entryStartTime: '09:15',
      mandatoryExitTime: '15:30',
      desiredNetProfitLock: 0,
    }).success).toBe(true);
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00', '2026-1-01', 'bad-date'])('rejects invalid calendar dates: %s', (tradingDate) => {
    expect(DailyBotTradingDateSchema.safeParse(tradingDate).success).toBe(false);
    expect(DailyBotCloneRequestSchema.safeParse({ tradingDate }).success).toBe(false);
  });

  it('accepts leap days in leap years', () => {
    expect(DailyBotTradingDateSchema.parse('2028-02-29')).toBe('2028-02-29');
  });
});
