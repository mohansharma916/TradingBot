import { DailyBotConfig, DailyBotConfigSchema, StrategyConfig, TradeMode } from '@trading-bot/contracts';

export type DailyBotDraft = Record<keyof DailyBotConfig, string>;

export function tradingDateInIst(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function createDailyBotDraft(date: string, strategy?: StrategyConfig): DailyBotDraft {
  return configToDraft(DailyBotConfigSchema.parse({
    name: 'My Daily Trading Bot', tradingDate: date, tradingMode: TradeMode.PAPER,
    dailyCapitalBudget: strategy?.risk.maxCapitalInr ?? 10000,
    dailyMaxLossAllIn: strategy?.risk.maxAllInDailyLossInr ?? 600,
    perTradeMaxLossAllIn: strategy?.risk.maxAllInTradeLossInr ?? 200,
    maxCapitalPerTrade: strategy?.risk.maxCapitalInr ?? 10000,
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
