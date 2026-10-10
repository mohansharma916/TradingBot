import { Body, Controller, Get, Param, Post, Inject } from '@nestjs/common';
import { TradeProposal } from '@trading-bot/contracts';
import { ProposalsService } from './proposals.service';

@Controller('trade-proposals')
export class ProposalsController {
  constructor(@Inject(ProposalsService) private readonly proposalsService: ProposalsService) {}

  @Get()
  getProposals(): TradeProposal[] {
    return this.proposalsService.getAllProposals();
  }

  @Get('pending')
  getPendingProposals(): TradeProposal[] {
    return this.proposalsService.getPendingProposals();
  }

  @Post(':id/approve')
  approveProposal(@Param('id') id: string) {
    const result = this.proposalsService.approveProposal(id);
    return {
      success: true,
      proposalId: id,
      intentId: result.intentId,
      status: 'USER_APPROVED',
      message: 'Proposal approved by owner. Dispatched to risk orchestrator.',
    };
  }

  @Post(':id/reject')
  rejectProposal(@Param('id') id: string, @Body('reason') reason = 'Rejected by owner') {
    return this.proposalsService.rejectProposal(id, reason);
  }
}
