import { Injectable, NotFoundException, BadRequestException, Inject, Optional } from '@nestjs/common';
import {
  ProposalStatus,
  TradeProposal,
  TradeProposalSchema,
} from '@trading-bot/contracts';
import { EventsGateway } from '../websocket/events.gateway';
import { EnvService } from '../config/env.service';
import fs from 'node:fs';
import path from 'node:path';

@Injectable()
export class ProposalsService {
  private proposals: Map<string, TradeProposal> = new Map();

  private storage: string | null;
  constructor(@Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Optional() @Inject(EnvService) env?: EnvService) {
    this.storage = !env || process.env.VITEST && (!env.config.STATE_DIRECTORY || env.config.STATE_DIRECTORY === '.data') ? null : path.resolve(env.config.STATE_DIRECTORY ?? '.data','proposals.json');
    if (this.storage && fs.existsSync(this.storage)) {
      const saved = JSON.parse(fs.readFileSync(this.storage,'utf8'));
      if (!Array.isArray(saved)) throw new Error('Proposal store is invalid.');
      for (const record of saved) {
        const proposal = TradeProposalSchema.parse(record);
        // Owner approvals are invalid after process restart; dispatch must be explicitly reviewed again.
        if ([ProposalStatus.APPROVED, ProposalStatus.PENDING].includes(proposal.status)) proposal.status = ProposalStatus.SUPERSEDED;
        this.proposals.set(proposal.id,proposal);
      }
    }
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
    this.proposals.set(proposal.id, TradeProposalSchema.parse(proposal));
    this.persist();
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
    this.persist();

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
    this.persist();
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
        [ProposalStatus.PENDING, ProposalStatus.APPROVED].includes(proposal.status) &&
        new Date(proposal.expiresAt).getTime() <= now
      ) {
        proposal.status = ProposalStatus.EXPIRED;
        this.proposals.set(id, proposal);
    this.persist();
        this.gateway.broadcast('proposal.expired', { proposalId: id });
      }
    }
  }

  public invalidateApprovals(strategyId?: string): void {
    for (const proposal of this.proposals.values()) if ((!strategyId || proposal.strategyId === strategyId) && [ProposalStatus.PENDING,ProposalStatus.APPROVED].includes(proposal.status)) proposal.status = ProposalStatus.SUPERSEDED;
    this.persist();
  }
  private persist(): void {
    if (!this.storage) return;
    fs.mkdirSync(path.dirname(this.storage),{recursive:true,mode:0o700});
    const temporary = this.storage + '.' + process.pid + '.tmp';
    const descriptor = fs.openSync(temporary,'w',0o600);
    try { fs.writeFileSync(descriptor,JSON.stringify(Array.from(this.proposals.values()))); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary,this.storage);
  }
}
