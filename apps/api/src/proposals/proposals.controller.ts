import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AgentType, OrderSide, ProductType, ProposalStatus, TradeProposal } from '@trading-bot/contracts';

@Controller('trade-proposals')
export class ProposalsController {
  private proposals: TradeProposal[] = [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: 'NSE_FO|52175',
      symbol: 'NIFTY26OCT25100CE',
      side: OrderSide.BUY,
      product: ProductType.I,
      suggestedEntryPrice: 122.5,
      suggestedStopPrice: 114.0,
      suggestedTargetPrice: 136.0,
      lotSize: 25,
      quantity: 25,
      estimatedCapitalRequired: 3062.5,
      estimatedRoundTripCosts: 58.2,
      allInMaxLoss: 270.7,
      estimatedNetProfit: 279.3,
      evidence: {
        indicators: {
          ema20: 25115.0,
          rsi14: 58.4,
          vwap: 25102.5,
        },
        rationale: '5m EMA bullish cross + RSI above 55 filter passed with tight spread',
        confidence: 0.78,
      },
      status: ProposalStatus.PENDING,
      expiresAt: new Date(Date.now() + 180000).toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];

  @Get()
  getProposals(): TradeProposal[] {
    return this.proposals.filter((p) => p.status === ProposalStatus.PENDING);
  }

  @Post(':id/approve')
  approveProposal(@Param('id') id: string) {
    const proposal = this.proposals.find((p) => p.id === id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found.`);
    }
    proposal.status = ProposalStatus.APPROVED;

    return {
      success: true,
      proposalId: id,
      intentId: `intent_${Date.now()}`,
      status: 'USER_APPROVED',
      message: 'Proposal approved by owner. Dispatched to risk orchestrator.',
    };
  }

  @Post(':id/reject')
  rejectProposal(@Param('id') id: string, @Body('reason') reason = 'Rejected by owner') {
    const proposal = this.proposals.find((p) => p.id === id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found.`);
    }
    proposal.status = ProposalStatus.REJECTED;

    return {
      success: true,
      proposalId: id,
      reason,
    };
  }
}
