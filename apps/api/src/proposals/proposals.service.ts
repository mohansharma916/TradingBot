import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import {
  AgentType,
  OrderSide,
  ProductType,
  ProposalStatus,
  TradeProposal,
} from '@trading-bot/contracts';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class ProposalsService {
  private proposals: Map<string, TradeProposal> = new Map();

  constructor(@Inject(EventsGateway) private readonly gateway: EventsGateway) {
    this.seedSampleProposal();
  }

  public getAllProposals(): TradeProposal[] {
    this.checkExpirations();
    return Array.from(this.proposals.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  public getPendingProposals(): TradeProposal[] {
    this.checkExpirations();
    return Array.from(this.proposals.values()).filter(
      (p) => p.status === ProposalStatus.PENDING,
    );
  }

  public getProposal(id: string): TradeProposal | undefined {
    this.checkExpirations();
    return this.proposals.get(id);
  }

  public addProposal(proposal: TradeProposal): void {
    this.proposals.set(proposal.id, proposal);
    this.gateway.broadcast('proposal.created', proposal);
  }

  public approveProposal(id: string): { success: boolean; intentId: string; proposal: TradeProposal } {
    this.checkExpirations();
    const proposal = this.proposals.get(id);
    if (!proposal) {
      throw new NotFoundException(`Trade proposal '${id}' not found.`);
    }

    if (proposal.status === ProposalStatus.EXPIRED) {
      throw new BadRequestException(`Cannot approve proposal '${id}': TTL has expired.`);
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(`Proposal '${id}' is already in status ${proposal.status}.`);
    }

    proposal.status = ProposalStatus.APPROVED;
    this.proposals.set(id, proposal);

    const intentId = `intent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.gateway.broadcast('proposal.approved', { proposalId: id, intentId });

    return {
      success: true,
      intentId,
      proposal,
    };
  }

  public rejectProposal(id: string, reason = 'Rejected by owner'): { success: boolean; proposal: TradeProposal } {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      throw new NotFoundException(`Trade proposal '${id}' not found.`);
    }

    proposal.status = ProposalStatus.REJECTED;
    this.proposals.set(id, proposal);
    this.gateway.broadcast('proposal.rejected', { proposalId: id, reason });

    return {
      success: true,
      proposal,
    };
  }

  private checkExpirations(): void {
    const now = Date.now();
    for (const [id, proposal] of this.proposals.entries()) {
      if (
        proposal.status === ProposalStatus.PENDING &&
        new Date(proposal.expiresAt).getTime() <= now
      ) {
        proposal.status = ProposalStatus.EXPIRED;
        this.proposals.set(id, proposal);
        this.gateway.broadcast('proposal.expired', { proposalId: id });
      }
    }
  }

  private seedSampleProposal(): void {
    const sample: TradeProposal = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      strategyId: '550e8400-e29b-41d4-a716-446655440002',
      strategyVersion: 1,
      proposingAgent: AgentType.STRATEGY_ANALYST,
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
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
          spreadPct: 0.24,
          volume: 45000,
        },
        rationale: '5m EMA bullish cross + RSI 58.4 confirmation on closed bar with tight 0.24% spread.',
        confidence: 0.78,
      },
      status: ProposalStatus.PENDING,
      expiresAt: new Date(Date.now() + 600000).toISOString(), // 10 minutes in future for demo
      createdAt: new Date().toISOString(),
    };

    this.proposals.set(sample.id, sample);
  }
}
