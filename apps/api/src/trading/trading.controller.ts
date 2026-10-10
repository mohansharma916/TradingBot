import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Post } from '@nestjs/common';
import { AccountFunds, SelectTradingModeSchema, TradeMode, TradingModeSnapshot } from '@trading-bot/contracts';
import { TradingModeService } from './trading-mode.service';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { BrokerRouterService } from '../broker/broker-router.service';
import { LiveExecutionLedgerService } from '../broker/live-execution-ledger.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { DailyBotStore } from '../daily-bot/daily-bot.store';
import { EnvService } from '../config/env.service';
import { ProposalsService } from '../proposals/proposals.service';

@Controller('trading')
export class TradingController {
  private switching = false;
  constructor(@Inject(TradingModeService) private readonly mode: TradingModeService,
    @Inject(UpstoxBrokerAdapter) private readonly live: UpstoxBrokerAdapter,
    @Inject(BrokerRouterService) private readonly broker: BrokerRouterService,
    @Inject(LiveExecutionLedgerService) private readonly ledger: LiveExecutionLedgerService,
    @Inject(RiskReservationManager) private readonly risk: RiskReservationManager,
    @Inject(DailyBotStore) private readonly dailyBots: DailyBotStore,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(ProposalsService) private readonly proposals: ProposalsService) {}

  @Get('mode')
  async snapshot(): Promise<TradingModeSnapshot> {
    if (this.switching) return this.mode.getSnapshot();
    const revision = this.mode.getRevision();
    const live = this.mode.isLive();
    try {
      const funds = live ? await this.liveFunds() : await this.paperFunds();
      if (this.switching || this.mode.getRevision() !== revision) return this.mode.getSnapshot();
      if (live) this.risk.synchronizeFunds(funds.availableCash);
      this.mode.updateFunds(funds);
    }
    catch (error) {
      // A response for an older ledger must not overwrite or disarm the newly selected account.
      if (!this.switching && this.mode.getRevision() === revision) {
        this.mode.markFundsUnavailable(error instanceof Error ? error.message : 'Account funds are unavailable.');
        this.risk.disarm();
      }
    }
    return this.mode.getSnapshot();
  }

  @Post('mode')
  async select(@Body() body: unknown): Promise<TradingModeSnapshot> {
    const parsed = SelectTradingModeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Select Testing (PAPER) or Live (APPROVAL).');
    if (this.switching) throw new ConflictException('A mode change is already in progress.');
    if (parsed.data.mode === this.mode.getMode()) return this.snapshot();
    const previousMode = this.mode.getMode();
    let configuringRisk = false;
    this.switching = true;
    this.risk.disarm();
    try {
      if (this.risk.getActiveReservations().length || this.ledger.hasUnresolvedExposure()) throw new ConflictException('Close or reconcile positions and pending orders before switching modes.');
      const running = this.dailyBots.snapshot().sessions.some(session => ['RUNNING', 'PAUSED', 'STOPPING'].includes(session.status) || session.trades.some(trade => trade.status !== 'CLOSED'));
      if (running) throw new ConflictException('Stop the Daily Bot and close its positions before switching modes.');
      const [positions, orders] = await Promise.all([this.broker.getPositions(), this.broker.getOrders()]);
      if (positions.some(position => position.netQuantity !== 0) || orders.some(order => ['SUBMITTING','ACKNOWLEDGED','PARTIALLY_FILLED','UNKNOWN_BROKER_STATE','CANCEL_REQUESTED'].includes(order.status))) throw new ConflictException('The current account has open positions or pending orders.');
      let funds: AccountFunds | undefined;
      if (parsed.data.mode !== TradeMode.PAPER) {
        if (!this.env.config.LIVE_EXECUTION_ENABLED) throw new BadRequestException('Live execution is disabled. Set LIVE_EXECUTION_ENABLED=true in the server environment and restart, then connect Upstox.');
        funds = await this.liveFunds();
        const [livePositions, liveOrders] = await Promise.all([this.live.getPositions(), this.live.getOrders()]);
        if (livePositions.some(position => position.netQuantity !== 0) || liveOrders.some(order => ['SUBMITTING','ACKNOWLEDGED','PARTIALLY_FILLED','UNKNOWN_BROKER_STATE','CANCEL_REQUESTED'].includes(order.status))) throw new ConflictException('Resolve existing Upstox positions or pending orders before enabling this trading runtime.');
      }
      // Disarm before changing either the adapter or ledger; a failed state write cannot dispatch.
      this.risk.disarm();
      configuringRisk = true;
      this.risk.configureMode(parsed.data.mode);
      this.mode.setMode(parsed.data.mode, funds);
      this.proposals.invalidateApprovals();
      if (funds) { this.broker.recoverLiveExposure(); this.risk.synchronizeFunds(funds.availableCash); }
      else this.mode.updateFunds(await this.paperFunds());
      return this.mode.getSnapshot();
    } catch (error) {
      this.risk.disarm();
      if (configuringRisk && this.mode.getMode() === previousMode) {
        try { this.risk.configureMode(previousMode); }
        catch { this.risk.setKillSwitch(true); }
      }
      throw error;
    } finally { this.switching = false; }
  }

  private async liveFunds(): Promise<AccountFunds> {
    const funds = await this.live.getFunds();
    if (funds.source !== 'LIVE_BROKER' || funds.status !== 'VERIFIED' || ![funds.availableCash,funds.usedMargin].every(value => Number.isFinite(value) && value >= 0)) throw new BadRequestException('Verified Upstox funds are required. Connect a genuine broker session.');
    return { availableCash: funds.availableCash, reservedMargin: funds.usedMargin, totalCapital: funds.availableCash + funds.usedMargin, source: 'LIVE_BROKER', status: 'VERIFIED', verifiedAt: funds.verifiedAt ?? new Date().toISOString() };
  }
  private async paperFunds(): Promise<AccountFunds> {
    const funds = await this.broker.getFunds();
    if (funds.source !== 'PAPER_SIMULATION' || !Number.isFinite(funds.availableCash) || funds.availableCash < 0) throw new Error('Paper ledger funds are unavailable.');
    const held = this.risk.getHeldReservations().reduce((sum,record) => sum + record.reservedCapital,0);
    const reservedMargin = funds.usedMargin + held;
    const availableCash = Math.max(0,funds.availableCash - held);
    return { availableCash, reservedMargin, totalCapital: availableCash + reservedMargin, source: 'PAPER_SIMULATION', status: 'VERIFIED', verifiedAt: new Date().toISOString() };
  }
}
