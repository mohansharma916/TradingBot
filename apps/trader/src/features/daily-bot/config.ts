import { DailyBotConfig, DailyBotConfigSchema, StrategyConfig, TradeMode } from '@trading-bot/contracts';
import { calculateOptionCharges, ChargeBreakdown } from '@trading-bot/domain';

export type DailyBotDraft = Record<keyof DailyBotConfig, string>;

export const DAILY_BOT_DRAFT_KEY = 'TRADING_BOT_DAILY_DRAFT';

export interface StoredDailyBotDraft {
  draft: DailyBotDraft;
  step: number;
  savedSetupId?: string | null;
  tradingDate: string;
}

/**
 * Calculates estimated round-trip option statutory charges and brokerage
 * dynamically as per official SEBI and NSE F&O transaction rules.
 *
 * Components computed:
 * - Brokerage: Flat ₹20 buy + ₹20 sell = ₹40.00
 * - STT: 0.15% on sell-side turnover
 * - Exchange Turnover Fee: 0.03553% on total turnover
 * - SEBI Turnover Charge: ₹10 per crore (0.0001%)
 * - Stamp Duty: 0.003% on buy-side turnover
 * - GST: 18% on (Brokerage + Exchange + SEBI charges)
 */
export function estimateSebiOptionCharges(tradeCapital: number): {
  totalEstimated: number;
  breakdown: ChargeBreakdown;
} {
  const cap = Math.max(100, Number(tradeCapital) || 5000);
  const breakdown = calculateOptionCharges({
    buyPrice: cap,
    sellPrice: cap,
    quantity: 1,
  });
  return {
    totalEstimated: Math.ceil(breakdown.totalRoundTripCharges),
    breakdown,
  };
}

export function loadSavedDraft(tradingDate: string): StoredDailyBotDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(DAILY_BOT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDailyBotDraft;
    if (parsed && parsed.tradingDate === tradingDate && parsed.draft) {
      return parsed;
    }
  } catch {}
  return null;
}

export function saveDraftToStorage(
  tradingDate: string,
  draft: DailyBotDraft | null,
  step = 0,
  savedSetupId: string | null = null,
) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!draft) {
      window.localStorage.removeItem(DAILY_BOT_DRAFT_KEY);
    } else {
      window.localStorage.setItem(
        DAILY_BOT_DRAFT_KEY,
        JSON.stringify({
          draft,
          step,
          savedSetupId,
          tradingDate,
        }),
      );
    }
  } catch {}
}

export function tradingDateInIst(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function createDailyBotDraft(date: string, strategy?: StrategyConfig): DailyBotDraft {
  const maxCap = strategy?.risk.maxCapitalInr ?? 10000;
  const estimatedCharges = estimateSebiOptionCharges(maxCap).totalEstimated;

  return configToDraft(DailyBotConfigSchema.parse({
    name: 'My Daily Trading Bot', tradingDate: date, tradingMode: TradeMode.PAPER,
    dailyCapitalBudget: strategy?.risk.maxCapitalInr ?? 10000,
    dailyMaxLossAllIn: strategy?.risk.maxAllInDailyLossInr ?? 600,
    perTradeMaxLossAllIn: strategy?.risk.maxAllInTradeLossInr ?? 200,
    maxCapitalPerTrade: maxCap,
    maxRoundTripCharges: estimatedCharges,
    strategyId: strategy?.id ?? '00000000-0000-4000-8000-000000000000',
    dailyNetProfitObjective: 4000,
  }));
}

export function configToDraft(config: DailyBotConfig): DailyBotDraft {
  const draft = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value)]));
  draft.dailyNetProfitObjective ??= '';
  return draft as DailyBotDraft;
}

export function validateDailyBotDraft(draft: DailyBotDraft) {
  const values: Record<string, unknown> = { ...draft };
  const textFields = new Set(['name', 'tradingDate', 'tradingMode', 'trailingAlgorithm',
    'entryStartTime', 'lastEntryTime', 'mandatoryExitTime', 'strategyId']);
  for (const [key, value] of Object.entries(draft)) {
    if (!textFields.has(key)) values[key] = value.trim() === '' ? undefined : Number(value);
  }
  return DailyBotConfigSchema.safeParse(values);
}

export const mainNavigation = [
  { name: 'Daily Trading Bot', href: '/', icon: '🤖' },
  { name: 'Markets', href: '/markets', icon: '📈' },
  { name: 'Strategies', href: '/strategies', icon: '⚡' },
  { name: 'Proposals', href: '/proposals', icon: '🎯' },
  { name: 'Orders', href: '/orders', icon: '📑' },
  { name: 'Risk Center', href: '/risk', icon: '🛡️' },
  { name: 'Health', href: '/health', icon: '🩺' },
  { name: 'Dashboard', href: '/dashboard', icon: '📊' },
] as const;
