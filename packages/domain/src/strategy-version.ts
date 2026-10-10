import { StrategyConfig } from '@trading-bot/contracts';

/**
 * Deterministic hash calculation for strategy versioning.
 * Node and browser safe implementation (using subtle crypto or fallback hash).
 */
export function calculateStrategyVersionHash(config: Partial<StrategyConfig>): string {
  // Extract core parameters that define the strategy's trading logic
  const canonicalData = {
    underlying: config.underlying,
    timeframe: config.timeframe,
    allowedInstruments: config.allowedInstruments,
    session: config.session,
    entry: config.entry,
    selection: config.selection,
    risk: {
      maxCapitalInr: config.risk?.maxCapitalInr ?? config.maxCapitalInr,
      maxAllInTradeLossInr: config.risk?.maxAllInTradeLossInr ?? config.maxAllInTradeLossInr,
      maxAllInDailyLossInr: config.risk?.maxAllInDailyLossInr ?? config.maxAllInDailyLossInr,
      maxOpenPositions: config.risk?.maxOpenPositions ?? config.maxOpenPositions,
      targetNetProfitInr: config.risk?.targetNetProfitInr ?? config.targetNetProfitInr,
    },
    exit: config.exit,
  };

  function canonicalize(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(canonicalize);
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }

  const jsonString = JSON.stringify(canonicalize(canonicalData));
  
  // FNV-1a 32-bit hash converted to 8-character hex for universal portability (Node & browser)
  let hash = 2166136261;
  for (let i = 0; i < jsonString.length; i++) {
    hash ^= jsonString.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const hexHash = (hash >>> 0).toString(16).padStart(8, '0');
  return `v${config.version ?? 1}-${hexHash}`;
}

/**
 * Checks whether changes between an old strategy and new strategy require
 * an immutable version bump.
 */
export function requiresVersionBump(
  existingConfig: StrategyConfig,
  updatedConfig: Partial<StrategyConfig>
): boolean {
  const oldHash = calculateStrategyVersionHash(existingConfig);
  const newHash = calculateStrategyVersionHash({ ...existingConfig, ...updatedConfig });
  return oldHash !== newHash;
}
