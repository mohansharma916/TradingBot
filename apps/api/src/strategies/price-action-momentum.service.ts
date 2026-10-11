import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AgentType,
  BacktestResult,
  InstrumentType,
  OrderSide,
  PriceActionMomentumConfig,
  PriceActionMomentumConfigSchema,
  PriceActionMomentumSignalResult,
  ProductType,
  ProposalStatus,
  TradeProposal,
} from '@trading-bot/contracts';
import {
  Candle,
  calculateOptionCharges,
  evaluatePriceActionMomentum,
  getStandardLotSize,
  runPriceActionMomentumBacktest,
  fetchRealHistoricalCandles,
} from '@trading-bot/domain';
import { ProposalsService } from '../proposals/proposals.service';
import { RiskService } from '../risk/risk.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { TokenStorageService } from '../broker/token-storage.service';

@Injectable()
export class PriceActionMomentumService {
  private readonly logger = new Logger(PriceActionMomentumService.name);
  private lastSignalTimestamps = new Map<string, string | number>();

  constructor(
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Inject(RiskService) private readonly riskService: RiskService,
    @Inject(InstrumentCatalogService) private readonly catalogService: InstrumentCatalogService,
    @Optional() @Inject(TokenStorageService) private readonly tokenStorage?: TokenStorageService,
  ) {}

  /**
   * Evaluates price action directional momentum on supplied completed 1m candles and current price.
   */
  public evaluateSignal(
    candles: Candle[],
    currentPrice: number,
    config?: Partial<PriceActionMomentumConfig>,
    fiveMinuteCandles?: Candle[],
  ): PriceActionMomentumSignalResult {
    const parsedConfig = PriceActionMomentumConfigSchema.parse(config ?? {});
    const underlying = parsedConfig.underlying;
    const lastSigTime = this.lastSignalTimestamps.get(underlying);

    const result = evaluatePriceActionMomentum({
      oneMinuteCandles: candles,
      fiveMinuteCandles,
      currentPrice,
      config: parsedConfig,
      lastSignalTimestamp: lastSigTime,
    });

    if (result.signal !== 'NO_TRADE') {
      this.lastSignalTimestamps.set(underlying, result.timestamp);
      this.logger.log(
        `[${underlying}] Generated ${result.signal} signal: Efficiency=${result.trendEfficiency}, BullishConfirmations=${result.bullishStructureConfirmations}, BearishConfirmations=${result.bearishStructureConfirmations}, BreakoutPrice=${currentPrice}`,
      );
    }

    return result;
  }

  /**
   * Generates and registers a TradeProposal if signal criteria, instrument selection,
   * and risk gates pass. Default trade mode is always PAPER.
   */
  public async generateProposalIfTriggered(
    candles: Candle[],
    currentPrice: number,
    strategyId: string,
    strategyVersion = 1,
    config?: Partial<PriceActionMomentumConfig>,
  ): Promise<TradeProposal | null> {
    const parsedConfig = PriceActionMomentumConfigSchema.parse(config ?? {});
    const evalResult = this.evaluateSignal(candles, currentPrice, parsedConfig);

    if (evalResult.signal === 'NO_TRADE') {
      return null;
    }

    const riskStatus = this.riskService.getStatus();
    if (riskStatus.killSwitchActive || riskStatus.state === 'EMERGENCY_STOP') {
      this.logger.warn(`Proposal blocked by Risk Service: Kill switch active or system in EMERGENCY_STOP.`);
      return null;
    }

    const underlying = parsedConfig.underlying;
    const targetInstrumentType = evalResult.signal === 'BUY_CE' ? InstrumentType.CE : InstrumentType.PE;
    const lotSize = getStandardLotSize(underlying);
    const tickSize = 0.05;

    // Search candidate contracts in instrument catalog
    const contracts = await this.catalogService.searchInstruments({
      query: underlying,
      underlying,
      instrumentType: targetInstrumentType,
      limit: 10,
    });

    if (!contracts || contracts.length === 0) {
      this.logger.warn(`No eligible ${targetInstrumentType} contracts found for ${underlying}.`);
      return null;
    }

    // Select ATM/near strike contract
    const strikeStep = underlying === 'BANKNIFTY' ? 100 : 50;
    const atmStrike = Math.round(currentPrice / strikeStep) * strikeStep;
    const candidate = contracts.find((c) => Math.abs((c as any).strikePrice - atmStrike) < strikeStep * 1.5) || contracts[0]!;

    const estimatedPremium = Math.max(25, Number((currentPrice * 0.0055).toFixed(2)));
    const quantity = lotSize;
    const entryPrice = estimatedPremium;

    // Preliminary round-trip statutory charges estimate
    const estimatedCharges = calculateOptionCharges({
      buyPrice: entryPrice,
      sellPrice: entryPrice,
      quantity,
    }).totalRoundTripCharges;

    // Structure-based protective stop
    let stopLossPoints = parsedConfig.stopLossValue;
    if (parsedConfig.stopLossType === 'STRUCTURE_BASED') {
      const spotRisk = evalResult.signal === 'BUY_CE'
        ? Math.max(5, currentPrice - evalResult.setupCandleLow)
        : Math.max(5, evalResult.setupCandleHigh - currentPrice);
      stopLossPoints = Number((spotRisk * 0.5).toFixed(2));
    }
    const maxLossBudget = Math.max(10, parsedConfig.maxAllInTradeLossInr - estimatedCharges - 5);
    const maxStopPoints = maxLossBudget / quantity;
    stopLossPoints = Math.min(stopLossPoints, maxStopPoints);
    const suggestedStopPrice = Math.max(tickSize, Number((entryPrice - stopLossPoints).toFixed(2)));

    const targetPoints = parsedConfig.targetProfitType === 'RISK_REWARD'
      ? Number((stopLossPoints * parsedConfig.riskRewardRatio).toFixed(2))
      : parsedConfig.targetPoints;
    const suggestedTargetPrice = Number((entryPrice + targetPoints).toFixed(2));

    const charges = calculateOptionCharges({
      buyPrice: entryPrice,
      sellPrice: suggestedTargetPrice,
      quantity,
    }).totalRoundTripCharges;

    const capitalRequired = Number((entryPrice * quantity + charges).toFixed(2));
    const allInMaxLoss = Number(((entryPrice - suggestedStopPrice) * quantity + charges).toFixed(2));
    const netProfit = Number(((suggestedTargetPrice - entryPrice) * quantity - charges).toFixed(2));

    // Risk gate verification
    if (allInMaxLoss > parsedConfig.maxAllInTradeLossInr) {
      this.logger.warn(`Proposal rejected by Risk Gate: all-in loss ₹${allInMaxLoss} > ₹${parsedConfig.maxAllInTradeLossInr}`);
      return null;
    }

    const now = Date.now();
    const proposal: TradeProposal = {
      id: randomUUID(),
      strategyId,
      strategyVersion,
      versionHash: 'price_action_momentum_v1',
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: candidate.instrumentKey,
      symbol: candidate.symbol,
      side: OrderSide.BUY,
      product: ProductType.I,
      suggestedEntryPrice: entryPrice,
      suggestedStopPrice,
      suggestedTargetPrice,
      lotSize,
      quantity,
      estimatedCapitalRequired: capitalRequired,
      estimatedRoundTripCosts: charges,
      allInMaxLoss,
      estimatedNetProfit: netProfit,
      evidence: {
        indicators: {
          priceChange: evalResult.priceChange,
          trendEfficiency: evalResult.trendEfficiency,
          bullishStructureConfirmations: evalResult.bullishStructureConfirmations,
          bearishStructureConfirmations: evalResult.bearishStructureConfirmations,
          breakoutTriggered: evalResult.breakoutTriggered,
        },
        rationale: `Price Action Momentum ${evalResult.signal} triggered: Efficiency ${evalResult.trendEfficiency.toFixed(2)}, Structure confirmations confirmed, breakout verified.`,
        confidence: 0.85,
      },
      status: ProposalStatus.PENDING,
      expiresAt: new Date(now + 180000).toISOString(),
      createdAt: new Date(now).toISOString(),
    };

    this.proposalsService.addProposal(proposal);
    this.logger.log(`Created proposal ${proposal.id} for ${proposal.symbol} (${proposal.side} ${proposal.quantity})`);
    return proposal;
  }

  /**
   * Runs historical backtesting with chronological 1m candles.
   */
  public async runBacktest(
    options: {
      underlying?: 'NIFTY' | 'BANKNIFTY';
      days?: number;
      fromDate?: string;
      toDate?: string;
      config?: Partial<PriceActionMomentumConfig>;
      initialCapital?: number;
    },
  ): Promise<BacktestResult & any> {
    const underlying = options.underlying ?? 'NIFTY';
    const days = options.days ?? 15;

    const authToken = this.tokenStorage?.hasValidToken()
      ? this.tokenStorage.getToken()?.accessToken
      : undefined;

    const { candles } = await fetchRealHistoricalCandles({
      underlying,
      days,
      interval: '1m',
      authToken,
      preferUpstox: true,
      fromDate: options.fromDate,
      toDate: options.toDate,
    });

    const lotSize = getStandardLotSize(underlying);

    return runPriceActionMomentumBacktest({
      candles,
      config: {
        ...options.config,
        underlying,
      },
      initialCapital: options.initialCapital ?? 10000,
      lotSize,
    });
  }

  /**
   * Phase 9 Parameter optimization matrix across lookback windows, efficiency, and MTF confirmation.
   */
  public runParameterOptimization(
    candles: Candle[],
    baseConfig?: Partial<PriceActionMomentumConfig>,
  ) {
    const candleWindows = [4, 6, 8, 10];
    const efficiencyThresholds = [0.5, 0.6, 0.7, 0.8];
    const mtfOptions = [false, true];
    const results: Array<{
      candleCount: number;
      minimumEfficiency: number;
      useMTF: boolean;
      totalTrades: number;
      winRatePct: number;
      profitFactor: number;
      netPnl: number;
      maxDrawdownPct: number;
      expectancy: number;
    }> = [];

    for (const count of candleWindows) {
      for (const eff of efficiencyThresholds) {
        for (const mtf of mtfOptions) {
          const run = runPriceActionMomentumBacktest({
            candles,
            config: {
              ...baseConfig,
              candleCount: count,
              minimumEfficiency: eff,
              useMultiTimeframeConfirmation: mtf,
            },
          });

          results.push({
            candleCount: count,
            minimumEfficiency: eff,
            useMTF: mtf,
            totalTrades: run.totalTrades,
            winRatePct: run.winRatePct,
            profitFactor: run.profitFactor,
            netPnl: run.netPnl,
            maxDrawdownPct: run.maxDrawdownPct,
            expectancy: run.expectancy,
          });
        }
      }
    }

    return results.sort((a, b) => b.netPnl - a.netPnl);
  }
}
