import { Injectable, Inject } from '@nestjs/common';
import {
  AgentToolName,
  AgentType,
  ScannedInstrumentCandidate,
  StrategyConfig,
  TradeProposal,
} from '@trading-bot/contracts';
import { StrategyEvaluationResult } from '@trading-bot/domain';
import { AgentToolsService } from './agent-tools.service';

export interface StrategyAnalystResult {
  candidateSymbol: string;
  evaluation: StrategyEvaluationResult;
  proposal?: TradeProposal;
  toolInvocations: Array<{
    tool: AgentToolName;
    timestamp: string;
    input: any;
    output: any;
  }>;
}

@Injectable()
export class StrategyAnalystAgent {
  public readonly agentType = AgentType.STRATEGY_ANALYST;

  constructor(@Inject(AgentToolsService) private readonly tools: AgentToolsService) {}

  /**
   * Evaluates closed bar indicators and deterministic rules for a selected candidate contract.
   * Can ONLY invoke read-only tools: calculate_indicators and evaluate_strategy.
   */
  public async analyzeCandidate(
    strategy: StrategyConfig,
    candidate: ScannedInstrumentCandidate,
    requireFreshQuotes = false,
  ): Promise<StrategyAnalystResult> {
    const toolInvocations: Array<{
      tool: AgentToolName;
      timestamp: string;
      input: any;
      output: any;
    }> = [];

    // 1. Calculate closed candle indicators
    const underlyingKey =
      ({NIFTY:'NSE_INDEX|Nifty 50',BANKNIFTY:'NSE_INDEX|Nifty Bank',FINNIFTY:'NSE_INDEX|Nifty Fin Service',MIDCPNIFTY:'NSE_INDEX|NIFTY MID SELECT'} as Record<string,string>)[strategy.underlying] ?? '';
    const indicatorInput = {
      instrumentKey: underlyingKey,
      timeframe: strategy.timeframe,
      emaPeriod: strategy.entry?.emaPeriod ?? 20,
      rsiPeriod: strategy.entry?.rsiPeriod ?? 14,
      requireFreshQuotes,
    };

    const indicatorOutput = await this.tools.executeTool(
      AgentToolName.CALCULATE_INDICATORS,
      indicatorInput,
    );

    toolInvocations.push({
      tool: AgentToolName.CALCULATE_INDICATORS,
      timestamp: new Date().toISOString(),
      input: indicatorInput,
      output: {
        isWarmedUp: indicatorOutput.isWarmedUp,
        ema: indicatorOutput.ema,
        rsi: indicatorOutput.rsi,
        vwap: indicatorOutput.vwap,
        lastClosedCandleTime: indicatorOutput.lastClosedCandleTime,
      },
    });

    if (!indicatorOutput.isWarmedUp) {
      return {
        candidateSymbol: candidate.symbol,
        evaluation: {
          passed: false,
          reasons: [
            `Indicators not ready: warm-up buffer missing ${indicatorOutput.missingWarmupCandles} closed bars.`,
          ],
          signal: 'NONE',
          confidence: 0,
          metrics: {
            closedCandlesCount: indicatorOutput.totalClosedCandles,
            isWarmedUp: false,
          },
        },
        toolInvocations,
      };
    }

    // 2. Evaluate Strategy Rules on closed bars
    const evaluateInput = {
      strategy,
      instrumentKey: candidate.instrumentKey,
      requireFreshQuotes,
    };

    const evaluation: StrategyEvaluationResult = await this.tools.executeTool(
      AgentToolName.EVALUATE_STRATEGY,
      evaluateInput,
    );

    toolInvocations.push({
      tool: AgentToolName.EVALUATE_STRATEGY,
      timestamp: new Date().toISOString(),
      input: {
        strategyId: strategy.id,
        instrumentKey: candidate.instrumentKey,
      },
      output: {
        passed: evaluation.passed,
        signal: evaluation.signal,
        confidence: evaluation.confidence,
        reasons: evaluation.reasons,
      },
    });

    if (evaluation.proposal) evaluation.proposal.versionHash = strategy.versionHash;
    return {
      candidateSymbol: candidate.symbol,
      evaluation,
      proposal: evaluation.proposal,
      toolInvocations,
    };
  }
}
