import { Injectable, NotFoundException, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AllowedOptionType,
  BacktestRequest,
  BacktestRequestSchema,
  BacktestResult,
  MoneynessType,
  StrategyAstConfigSchema,
  StrategyConfig,
  StrategyConfigSchema,
  StrategyStatus,
  TradeMode,
} from '@trading-bot/contracts';
import {
  ALL_STRATEGY_TEMPLATES,
  PRICE_ACTION_MOMENTUM_TEMPLATE,
  StrategyTemplateItem,
  calculateStrategyVersionHash,
  fetchRealHistoricalCandles,
  requiresVersionBump,
  runStrategyBacktest,
} from '@trading-bot/domain';
import { TokenStorageService } from '../broker/token-storage.service';
import { EnvService } from '../config/env.service';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { ProposalsService } from '../proposals/proposals.service';

@Injectable()
export class StrategiesService {
  private strategies: Map<string, StrategyConfig> = new Map();
  private strategyVersionHistory: Map<string, StrategyConfig[]> = new Map();
  private readonly storagePath: string;

  constructor(
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Optional() @Inject('STRATEGIES_STORAGE_PATH') storagePath?: string,
    @Optional() @Inject(EnvService) env?: EnvService,
    @Optional() @Inject(TokenStorageService) private readonly tokens?: TokenStorageService,
  ) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    this.storagePath = storagePath || process.env.STRATEGIES_STORAGE_PATH || (isTest ? '' : path.resolve(env?.config.STATE_DIRECTORY ?? '.data', 'strategies.json'));
    if (this.storagePath) {
      this.loadFromDisk();
    } else {
      this.seedDefaultStrategies();
    }
  }

  private loadFromDisk(): void {
    this.seedDefaultStrategies();
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.strategies)) {
          for (const strat of parsed.strategies) {
            try {
              const validated = StrategyConfigSchema.parse(strat);
              this.strategies.set(validated.id, validated);
            } catch { throw new Error('Invalid persisted strategy.'); }
          }
        }
        if (parsed?.versionHistory && typeof parsed.versionHistory === 'object') {
          for (const [id, hist] of Object.entries(parsed.versionHistory)) {
            if (Array.isArray(hist)) {
              this.strategyVersionHistory.set(id, hist.map(record => StrategyConfigSchema.parse(record)));
            }
          }
        }
      }
    } catch { throw new Error('Persisted strategies cannot be validated; trading startup is blocked.'); }
  }

  private saveToDisk(): void {
    if (!this.storagePath) return;
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    const temporary = this.storagePath + '.' + randomUUID() + '.tmp';
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({strategies:[...this.strategies.values()], versionHistory:Object.fromEntries(this.strategyVersionHistory)}));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.storagePath);
    const dirFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }

  private findStrategyInDailyBotStorage(id: string): StrategyConfig | undefined {
    try {
      const dailyBotPath = path.resolve(path.dirname(this.storagePath), 'daily-bot.json');
      if (fs.existsSync(dailyBotPath)) {
        const raw = JSON.parse(fs.readFileSync(dailyBotPath, 'utf8'));
        const foundSetup = raw?.setups?.find((s: any) => s.strategySnapshot?.id === id);
        if (foundSetup?.strategySnapshot) {
          const validated = StrategyConfigSchema.parse(foundSetup.strategySnapshot);
          this.strategies.set(validated.id, validated);
          this.saveToDisk();
          return validated;
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  public getAllStrategies(): StrategyConfig[] {
    return Array.from(this.strategies.values());
  }

  public getStrategy(id: string): StrategyConfig {
    let strategy = this.strategies.get(id);
    if (!strategy) {
      // Reload in case another thread wrote to disk
      this.loadFromDisk();
      strategy = this.strategies.get(id);
    }
    if (!strategy) {
      // Check Daily Bot setup storage for matching snapshot
      strategy = this.findStrategyInDailyBotStorage(id);
    }
    if (!strategy) {
      throw new NotFoundException(`Strategy '${id}' not found.`);
    }
    return strategy;
  }

  public getVersionHistory(id: string): StrategyConfig[] {
    return this.strategyVersionHistory.get(id) || [];
  }

  public createStrategy(dto: any): StrategyConfig {
    const isUuid = typeof dto.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.id);
    const id = isUuid ? dto.id : randomUUID();
    const parsed = StrategyConfigSchema.parse({
      ...dto,
      id,
      version: dto.version || 1,
    });

    parsed.versionHash = calculateStrategyVersionHash(parsed);
    this.strategies.set(id, parsed);
    this.strategyVersionHistory.set(id, [parsed]);
    this.saveToDisk();

    return parsed;
  }

  public getTemplates(): StrategyTemplateItem[] {
    return ALL_STRATEGY_TEMPLATES;
  }

  public validateStrategyAst(astConfig: any): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const parsed = StrategyAstConfigSchema.safeParse(astConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      return { valid: false, errors, warnings };
    }

    const ast = parsed.data;
    const indicatorIds = new Set((ast.indicators || []).map((i) => i.id));

    // Check indicator uniqueness
    const seenIds = new Set<string>();
    for (const ind of ast.indicators || []) {
      if (seenIds.has(ind.id)) {
        errors.push(`Duplicate indicator ID '${ind.id}'. Each indicator must have a unique identifier.`);
      }
      seenIds.add(ind.id);
    }

    // Helper to check conditions
    const checkGroup = (group: any, name: string) => {
      if (!group) return;
      if (!group.conditions || group.conditions.length === 0) {
        warnings.push(`${name} rule group has no active conditions.`);
      }
      for (const c of group.conditions || []) {
        if ('operator' in c) {
          checkGroup(c, `${name} -> Nested Group`);
        } else {
          if (c.left?.type === 'INDICATOR' && c.left.indicatorId && !indicatorIds.has(c.left.indicatorId)) {
            errors.push(`Condition in ${name} references undefined indicator '${c.left.indicatorId}'.`);
          }
          if (c.right?.type === 'INDICATOR' && c.right.indicatorId && !indicatorIds.has(c.right.indicatorId)) {
            errors.push(`Condition in ${name} references undefined indicator '${c.right.indicatorId}'.`);
          }
        }
      }
    };

    checkGroup(ast.bullishEntry, 'Bullish Entry');
    checkGroup(ast.bearishEntry, 'Bearish Entry');

    // Risk / Exit checks
    if (!ast.exitRules?.stopLossValue || ast.exitRules.stopLossValue <= 0) {
      warnings.push('Protective Stop-Loss is not configured or <= 0.');
    }
    if (!ast.exitRules?.targetProfitValue || ast.exitRules.targetProfitValue <= 0) {
      warnings.push('Target Profit is not configured or <= 0.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public createFromTemplate(templateId: string, overrides: any = {}): StrategyConfig {
    const tpl = ALL_STRATEGY_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) {
      throw new NotFoundException(`Template '${templateId}' not found.`);
    }

    const isUuid = typeof overrides.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(overrides.id);
    const id = isUuid ? overrides.id : randomUUID();

    const configData: Partial<StrategyConfig> = {
      ...tpl.defaultConfig,
      ...overrides,
      id,
      name: overrides.name || tpl.name,
      description: overrides.description || tpl.description,
      category: tpl.category,
      templateId: tpl.id,
      version: 1,
      status: StrategyStatus.DRAFT,
      tradeMode: TradeMode.PAPER,
      astConfig: overrides.astConfig || tpl.astConfig,
    };

    const parsed = StrategyConfigSchema.parse(configData);
    parsed.versionHash = calculateStrategyVersionHash(parsed);
    this.strategies.set(id, parsed);
    this.strategyVersionHistory.set(id, [parsed]);
    this.saveToDisk();

    return parsed;
  }

  public duplicateStrategy(id: string): StrategyConfig {
    const original = this.getStrategy(id);
    const newId = randomUUID();

    const clone: StrategyConfig = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      version: 1,
      status: StrategyStatus.DRAFT,
    };

    clone.versionHash = calculateStrategyVersionHash(clone);
    this.strategies.set(newId, clone);
    this.strategyVersionHistory.set(newId, [clone]);
    this.saveToDisk();

    return clone;
  }

  public archiveStrategy(id: string): StrategyConfig {
    const strategy = this.getStrategy(id);
    strategy.status = StrategyStatus.ARCHIVED;
    strategy.isArchived = true;
    strategy.versionHash = calculateStrategyVersionHash(strategy);
    this.strategies.set(id, strategy);
    this.saveToDisk();
    return strategy;
  }

  public updateStrategy(id: string, updates: any): StrategyConfig {
    const existing = this.getStrategy(id);

    // Merge changes
    const merged = {
      ...existing,
      ...updates,
      id: existing.id,
      description: updates.description !== undefined ? updates.description : existing.description,
      category: updates.category !== undefined ? updates.category : existing.category,
      tags: updates.tags !== undefined ? updates.tags : existing.tags,
      astConfig: updates.astConfig !== undefined ? updates.astConfig : existing.astConfig,
      entry: { ...existing.entry, ...(updates.entry || {}) },
      risk: { ...existing.risk, ...(updates.risk || {}) },
      session: { ...existing.session, ...(updates.session || {}) },
      exit: { ...existing.exit, ...(updates.exit || {}) },
      selection: { ...existing.selection, ...(updates.selection || {}) },
    };

    // Validate merged config against strict limits
    const validated = StrategyConfigSchema.parse(merged);

    // Detect if immutable version bump is needed
    if (requiresVersionBump(existing, validated)) {
      validated.version = existing.version + 1;
      validated.status = StrategyStatus.DRAFT;
      this.proposalsService.invalidateApprovals(id);
      const history = this.strategyVersionHistory.get(id) || [];
      history.push(existing);
      this.strategyVersionHistory.set(id, history);
    }

    validated.versionHash = calculateStrategyVersionHash(validated);
    this.strategies.set(id, validated);
    this.saveToDisk();

    return validated;
  }

  public async runAgentScan(id: string) {
    const strategy = this.getStrategy(id);
    const result = await this.coordinator.runStrategyWorkflow(strategy);

    if (result.proposal) {
      this.proposalsService.addProposal(result.proposal);
    }

    return result;
  }

  public async runBacktest(id: string, reqDto: Partial<BacktestRequest>): Promise<BacktestResult> {
    const parsedReq = BacktestRequestSchema.parse(reqDto || {});
    let strategy: StrategyConfig;

    const tpl = ALL_STRATEGY_TEMPLATES.find((t) => t.id === id);
    if (tpl) {
      strategy = {
        ...tpl.defaultConfig,
        id: tpl.id,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        templateId: tpl.id,
        version: 1,
        status: StrategyStatus.DRAFT,
        tradeMode: TradeMode.PAPER,
        underlying: tpl.recommendedUnderlying,
        timeframe: tpl.recommendedTimeframe,
        astConfig: tpl.astConfig,
        ...(parsedReq.strategy || {}),
      } as StrategyConfig;
    } else {
      try {
        strategy = this.getStrategy(id);
      } catch (err) {
        if (parsedReq.strategy) {
          strategy = parsedReq.strategy as StrategyConfig;
        } else {
          throw err;
        }
      }
    }

    const underlying = reqDto?.underlying || strategy.underlying;
    const interval = (reqDto?.timeframe || strategy.timeframe || '5m') as BacktestRequest['timeframe'];

    // Respect requested and configured limits strictly without synthetic inflation
    const maxTradeLoss = parsedReq.maxTradeLossInr ?? strategy.risk?.maxAllInTradeLossInr ?? 500;
    const maxDailyLoss = parsedReq.maxDailyLossInr ?? strategy.risk?.maxAllInDailyLossInr ?? 1500;
    const maxRoundTripCostBudget = strategy.risk?.maxRoundTripCostBudgetInr ?? strategy.maxRoundTripCostBudgetInr ?? 60;

    // Keep strategy aligned with backtest request params and timeframe
    strategy = {
      ...strategy,
      underlying,
      timeframe: interval,
      risk: {
        ...strategy.risk,
        maxAllInTradeLossInr: maxTradeLoss,
        maxAllInDailyLossInr: maxDailyLoss,
        maxRoundTripCostBudgetInr: maxRoundTripCostBudget,
      },
      maxRoundTripCostBudgetInr: maxRoundTripCostBudget,
    };

    const effectiveReq: BacktestRequest = {
      ...parsedReq,
      timeframe: interval,
      maxTradeLossInr: maxTradeLoss,
      maxDailyLossInr: maxDailyLoss,
    };

    // Underlying OHLC comes from a named provider; options premiums remain a disclosed model.
    const { candles, dataSource } = await fetchRealHistoricalCandles({
      underlying,
      days: parsedReq.days,
      interval,
      authToken: this.tokens?.hasValidToken() ? this.tokens.getToken()?.accessToken : undefined,
      preferUpstox: true,
      fromDate: parsedReq.fromDate,
      toDate: parsedReq.toDate,
    });

    return runStrategyBacktest({
      strategy,
      candles,
      request: effectiveReq,
      dataSource,
    });
  }

  private seedDefaultStrategies(): void {
    const defaultStrategy: StrategyConfig = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      name: 'NIFTY EMA20 RSI Long Call',
      version: 1,
      status: StrategyStatus.DRAFT,
      tradeMode: TradeMode.PAPER,
      market: 'NSE_FO',
      underlying: 'NIFTY',
      allowedInstruments: [AllowedOptionType.LONG_CALL],
      timeframe: '5m',
      session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      entry: {
        emaPeriod: 20,
        rsiPeriod: 14,
        rsiThreshold: 55,
        maxBidAskSpreadPct: 1.0,
        minVolume: 1000,
      },
      selection: {
        expiry: 'NEAREST_ELIGIBLE',
        moneyness: MoneynessType.ATM,
        minVolume: 1000,
      },
      risk: {
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 200,
        maxAllInDailyLossInr: 600,
        maxOpenPositions: 1,
        maxTradesPerDay: 3,
        targetNetProfitInr: 300,
        maxRoundTripCostBudgetInr: 60,
      },
      exit: {
        stopBasis: 'OPTION_PREMIUM',
        marketCutoff: '15:10',
      },
      maxCapitalInr: 10000,
      maxAllInTradeLossInr: 200,
      maxAllInDailyLossInr: 600,
      targetNetProfitInr: 300,
      maxRoundTripCostBudgetInr: 60,
      maxOpenPositions: 1,
      requiresApproval: true,
    };

    defaultStrategy.versionHash = calculateStrategyVersionHash(defaultStrategy);
    this.strategies.set(defaultStrategy.id, defaultStrategy);
    this.strategyVersionHistory.set(defaultStrategy.id, [defaultStrategy]);

    const pamStrategy: StrategyConfig = {
      id: '550e8400-e29b-41d4-a716-446655440003',
      name: 'NIFTY Price Action Directional Momentum',
      version: 1,
      status: StrategyStatus.DRAFT,
      tradeMode: TradeMode.PAPER,
      market: 'NSE_FO',
      underlying: 'NIFTY',
      allowedInstruments: [AllowedOptionType.LONG_CALL, AllowedOptionType.LONG_PUT],
      timeframe: '1m',
      session: { start: '09:25', lastEntry: '14:45', timezone: 'Asia/Kolkata' },
      astConfig: PRICE_ACTION_MOMENTUM_TEMPLATE.astConfig,
      entry: {
        emaPeriod: 20,
        rsiPeriod: 14,
        rsiThreshold: 50,
        maxBidAskSpreadPct: 1.0,
        minVolume: 1000,
      },
      selection: {
        expiry: 'NEAREST_ELIGIBLE',
        moneyness: MoneynessType.ATM,
        minVolume: 1000,
      },
      risk: {
        maxCapitalInr: 10000,
        maxAllInTradeLossInr: 500,
        maxAllInDailyLossInr: 600,
        maxOpenPositions: 1,
        maxTradesPerDay: 4,
        targetNetProfitInr: 600,
        maxRoundTripCostBudgetInr: 60,
      },
      exit: {
        stopBasis: 'OPTION_PREMIUM',
        marketCutoff: '15:10',
      },
      maxCapitalInr: 10000,
      maxAllInTradeLossInr: 500,
      maxAllInDailyLossInr: 600,
      targetNetProfitInr: 600,
      maxRoundTripCostBudgetInr: 60,
      maxOpenPositions: 1,
      requiresApproval: true,
    };
    pamStrategy.versionHash = calculateStrategyVersionHash(pamStrategy);
    this.strategies.set(pamStrategy.id, pamStrategy);
    this.strategyVersionHistory.set(pamStrategy.id, [pamStrategy]);
  }
}
