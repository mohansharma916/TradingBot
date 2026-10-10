import { Injectable, Inject } from '@nestjs/common';
import {
  AgentToolName,
  AgentType,
  ScannedInstrumentCandidate,
  StrategyConfig,
} from '@trading-bot/contracts';
import { AgentToolsService } from './agent-tools.service';

export interface MarketScannerResult {
  underlying: string;
  spotPrice: number;
  topCandidates: ScannedInstrumentCandidate[];
  evidenceRationale: string;
  toolInvocation: {
    tool: AgentToolName;
    timestamp: string;
    input: any;
    output: any;
  };
}

@Injectable()
export class MarketScannerAgent {
  public readonly agentType = AgentType.MARKET_SCANNER;

  constructor(@Inject(AgentToolsService) private readonly tools: AgentToolsService) {}

  /**
   * Scans universe for options contracts meeting liquidity and spread criteria.
   * Can ONLY invoke read-only tool: scan_universe.
   */
  public async scanUniverse(strategy: StrategyConfig): Promise<MarketScannerResult> {
    const input = {
      underlying: strategy.underlying,
      minVolume: strategy.entry?.minVolume ?? 1000,
      maxSpreadPct: strategy.entry?.maxBidAskSpreadPct ?? 1.0,
    };

    const output = await this.tools.executeTool(AgentToolName.SCAN_UNIVERSE, input);
    const topCandidates = (output.candidates as ScannedInstrumentCandidate[]).slice(0, 5);

    const evidenceRationale =
      topCandidates.length > 0
        ? `Identified ${topCandidates.length} liquid candidate contracts with bid/ask spreads < ${input.maxSpreadPct}% and volume >= ${input.minVolume}. Top candidate: ${topCandidates[0]?.symbol} (Spread: ${topCandidates[0]?.spreadPct}%, Liquidity score: ${topCandidates[0]?.liquidityScore}/100).`
        : `No contracts in ${strategy.underlying} currently meet the maximum spread threshold of ${input.maxSpreadPct}% and minimum volume ${input.minVolume}.`;

    return {
      underlying: output.underlying,
      spotPrice: output.spotPrice,
      topCandidates,
      evidenceRationale,
      toolInvocation: {
        tool: AgentToolName.SCAN_UNIVERSE,
        timestamp: output.timestamp,
        input,
        output: {
          candidatesCount: topCandidates.length,
          topSymbol: topCandidates[0]?.symbol,
          topSpread: topCandidates[0]?.spreadPct,
        },
      },
    };
  }
}
