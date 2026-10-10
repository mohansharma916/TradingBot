import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
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

  constructor(
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
  ) {
    this.seedDefaultStrategies();
  }

  public getAllStrategies(): StrategyConfig[] {
    return Array.from(this.strategies.values());
  }

  public getStrategy(id: string): StrategyConfig {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new NotFoundException(`Strategy '${id}' not found.`);
    }
    return strategy;
  }

  public getVersionHistory(id: string): StrategyConfig[] {
    return this.strategyVersionHistory.get(id) || [];
  }

  public createStrategy(dto: any): StrategyConfig {
    const id = dto.id || randomUUID();
    const parsed = StrategyConfigSchema.parse({
      ...dto,
      id,
      version: dto.version || 1,
    });

    parsed.versionHash = calculateStrategyVersionHash(parsed);
    this.strategies.set(id, parsed);
    this.strategyVersionHistory.set(id, [parsed]);

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
    const strategy = this.getStrategy(id);
    const parsedReq = BacktestRequestSchema.parse(reqDto || {});

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
