import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  AgentTask,
  AgentTaskStatus,
  AgentType,
  StrategyConfig,
  TradeProposal,
} from '@trading-bot/contracts';
import { MarketScannerAgent } from './market-scanner.agent';
import { StrategyAnalystAgent } from './strategy-analyst.agent';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class AgentCoordinatorService {
  private readonly logger = new Logger(AgentCoordinatorService.name);
  private recentTasks: AgentTask[] = [];

  constructor(
    @Inject(MarketScannerAgent) private readonly scanner: MarketScannerAgent,
    @Inject(StrategyAnalystAgent) private readonly analyst: StrategyAnalystAgent,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {
    this.seedSampleTasks();
  }

  /**
   * Runs the full read-only multi-agent scanning and analysis workflow.
   * Safety Invariant: No broker order tool exists or can be called.
   */
  public async runStrategyWorkflow(
    strategy: StrategyConfig,
    options: { strictMarketData?: boolean } = {},
  ): Promise<{ task: AgentTask; proposal?: TradeProposal }> {
    const startedAt = new Date().toISOString();
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.logger.log(`[AgentCoordinator] Starting analysis workflow for strategy: ${strategy.name} (v${strategy.version})`);

    const task: AgentTask = {
      id: taskId,
      agentType: AgentType.COORDINATOR,
      status: AgentTaskStatus.RUNNING,
      objective: `Scan ${strategy.underlying} liquid options and evaluate 5m EMA/RSI rules for strategy '${strategy.name}'`,
      toolsInvoked: [],
      resultSummary: 'Executing MarketScanner...',
      startedAt,
    };

    try {
      // 1. Dispatch Market Scanner
      const scanResult = await this.scanner.scanUniverse(strategy, options.strictMarketData);
      task.toolsInvoked.push(scanResult.toolInvocation);

      if (scanResult.topCandidates.length === 0) {
        task.status = AgentTaskStatus.COMPLETED;
        task.resultSummary = scanResult.evidenceRationale;
        task.completedAt = new Date().toISOString();
        this.saveTask(task);
        return { task };
      }

      const candidate = scanResult.topCandidates[0]!;

      // 2. Dispatch Strategy Analyst on top liquid candidate
      const analysisResult = await this.analyst.analyzeCandidate(strategy, candidate, options.strictMarketData);
      for (const invocation of analysisResult.toolInvocations) {
        task.toolsInvoked.push(invocation);
      }

      if (analysisResult.evaluation.passed && analysisResult.proposal) {
        task.status = AgentTaskStatus.COMPLETED;
        task.proposalGenerated = analysisResult.proposal;
        task.resultSummary = `Signal confirmed for ${candidate.symbol}: ${analysisResult.proposal.evidence.rationale}. Trade proposal created (expires in 3m).`;
        task.completedAt = new Date().toISOString();

        // Broadcast to universal client
        this.gateway.broadcast('agent.proposal.created', analysisResult.proposal);
        this.gateway.broadcast('agent.task.completed', task);
        this.saveTask(task);

        return { task, proposal: analysisResult.proposal };
      } else {
        task.status = AgentTaskStatus.COMPLETED;
        task.resultSummary = `Candidate ${candidate.symbol} evaluated: Criteria not satisfied (${analysisResult.evaluation.reasons.join(', ')}).`;
        task.completedAt = new Date().toISOString();
        this.saveTask(task);
        return { task };
      }
    } catch (err: any) {
      this.logger.error(`[AgentCoordinator] Task ${taskId} failed: ${err.message}`);
      task.status = AgentTaskStatus.FAILED;
      task.error = err.message;
      task.completedAt = new Date().toISOString();
      this.saveTask(task);
      return { task };
    }
  }

  public getRecentTasks(): AgentTask[] {
    return [...this.recentTasks];
  }

  private saveTask(task: AgentTask): void {
    this.recentTasks.unshift(task);
    if (this.recentTasks.length > 50) {
      this.recentTasks.pop();
    }
  }

  private seedSampleTasks(): void {
    this.recentTasks.push({
      id: '550e8400-e29b-41d4-a716-446655440077',
      agentType: AgentType.COORDINATOR,
      status: AgentTaskStatus.COMPLETED,
      objective: 'Scheduled 5m close scan for NIFTY EMA20 RSI strategy',
      toolsInvoked: [
        {
          tool: 'scan_universe' as any,
          timestamp: new Date(Date.now() - 300000).toISOString(),
          input: { underlying: 'NIFTY', minVolume: 1000, maxSpreadPct: 1.0 },
          output: { candidatesCount: 8, topSymbol: 'NIFTY26OCT25100CE', topSpread: 0.24 },
        },
        {
          tool: 'calculate_indicators' as any,
          timestamp: new Date(Date.now() - 295000).toISOString(),
          input: { instrumentKey: 'NSE_INDEX|Nifty 50', timeframe: '5m', emaPeriod: 20, rsiPeriod: 14 },
          output: { isWarmedUp: true, ema: 25115.0, rsi: 58.4, vwap: 25102.5 },
        },
        {
          tool: 'evaluate_strategy' as any,
          timestamp: new Date(Date.now() - 290000).toISOString(),
          input: { strategyId: '550e8400-e29b-41d4-a716-446655440002', instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE' },
          output: { passed: true, signal: 'BUY_CALL', confidence: 0.78 },
        },
      ],
      resultSummary: 'Signal confirmed for NIFTY 25100 CE. 5m EMA crossed above, RSI 58.4 with 0.24% spread. Proposal drafted.',
      startedAt: new Date(Date.now() - 300000).toISOString(),
      completedAt: new Date(Date.now() - 285000).toISOString(),
    });
  }
}
