import { Controller, Get, Inject } from '@nestjs/common';
import { AgentToolName } from '@trading-bot/contracts';
import { AgentCoordinatorService } from './agent-coordinator.service';

@Controller('agents')
export class AgentsController {
  constructor(
    @Inject(AgentCoordinatorService) private readonly coordinator: AgentCoordinatorService,
  ) {}

  @Get('tasks')
  getRecentTasks() {
    return this.coordinator.getRecentTasks();
  }

  @Get('tools')
  getRegisteredTools() {
    return {
      permissionModel: 'READ_ONLY_STRICT',
      prohibitedActions: ['place_order', 'modify_order', 'cancel_order', 'transfer_funds'],
      allowedTools: [
        {
          name: AgentToolName.SCAN_UNIVERSE,
          description: 'Scans F&O instrument universe, checks liquidity and bid/ask spreads',
          readOnly: true,
        },
        {
          name: AgentToolName.CALCULATE_INDICATORS,
          description: 'Calculates EMA, RSI, and VWAP on confirmed closed candle bars with warm-up buffer',
          readOnly: true,
        },
        {
          name: AgentToolName.EVALUATE_STRATEGY,
          description: 'Evaluates deterministic strategy entry rules on closed bars',
          readOnly: true,
        },
        {
          name: AgentToolName.DRAFT_TRADE_PROPOSAL,
          description: 'Drafts structured, expiring TradeProposal object with objective evidence',
          readOnly: true,
        },
      ],
    };
  }
}
