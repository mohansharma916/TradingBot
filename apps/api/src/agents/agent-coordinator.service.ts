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
      objective: `Scan ${strategy.underlying} observed option quotes and evaluate ${strategy.timeframe} strategy rules for '${strategy.name}'`,
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

}
