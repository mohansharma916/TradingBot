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
  StrategyConfig,
  StrategyConfigSchema,
  StrategyStatus,
  TradeMode,
} from '@trading-bot/contracts';
import {
  calculateStrategyVersionHash,
  fetchRealHistoricalCandles,
  requiresVersionBump,
  runStrategyBacktest,
} from '@trading-bot/domain';
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
  ) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    this.storagePath = storagePath || process.env.STRATEGIES_STORAGE_PATH || (isTest ? '' : path.resolve(process.cwd(), '.data/strategies.json'));
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
            } catch {
              // skip invalid entries
            }
          }
        }
        if (parsed?.versionHistory && typeof parsed.versionHistory === 'object') {
          for (const [id, hist] of Object.entries(parsed.versionHistory)) {
            if (Array.isArray(hist)) {
              this.strategyVersionHistory.set(id, hist as StrategyConfig[]);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[StrategiesService] Could not load persisted strategies from disk:', err);
    }
  }

  private saveToDisk(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        strategies: Array.from(this.strategies.values()),
        versionHistory: Object.fromEntries(this.strategyVersionHistory.entries()),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn('[StrategiesService] Could not persist strategies to disk:', err);
    }
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

  public updateStrategy(id: string, updates: any): StrategyConfig {
    const existing = this.getStrategy(id);

    // Merge changes
    const merged = {
      ...existing,
      ...updates,
      id: existing.id,
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
    try {
      strategy = this.getStrategy(id);
    } catch (err) {
      if (parsedReq.strategy) {
        strategy = this.createStrategy({ ...parsedReq.strategy, id });
      } else {
        throw err;
      }
    }

    const underlying = parsedReq.underlying || strategy.underlying || 'NIFTY';
    const interval = parsedReq.timeframe || strategy.timeframe || '5m';

    // Fetch 100% REAL historical exchange candles from Yahoo Finance / Upstox API
    const { candles, dataSource } = await fetchRealHistoricalCandles({
      underlying,
      days: parsedReq.days,
      interval,
      fromDate: parsedReq.fromDate,
      toDate: parsedReq.toDate,
    });

    return runStrategyBacktest({
      strategy,
      candles,
      request: parsedReq,
      dataSource,
    });
  }

  private seedDefaultStrategies(): void {
    const defaultStrategy: StrategyConfig = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      name: 'NIFTY EMA20 RSI Long Call',
      version: 1,
      status: StrategyStatus.PAPER_ACTIVE,
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
  }
}
