import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import {
  BrokerOrder,
  OrderSide,
  OrderStatus,
  OrderType,
  Position,
  ProductType,
} from '@trading-bot/contracts';
import { PaperBrokerAdapter, OrderFillEvent } from '../broker/paper-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { ProposalsService } from '../proposals/proposals.service';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PaperBrokerAdapter) private readonly broker: PaperBrokerAdapter,
    @Inject(RiskReservationManager) private readonly reservationManager: RiskReservationManager,
    @Inject(ProposalsService) private readonly proposalsService: ProposalsService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  public async getOrders(): Promise<BrokerOrder[]> {
    return this.broker.getOrders();
  }

  public async getPositions(): Promise<Position[]> {
    return this.broker.getPositions();
  }

  public getFills(): OrderFillEvent[] {
    return this.broker.getFills();
  }

  /**
   * Executes an approved TradeProposal in PAPER mode.
   * Atomic Steps:
   * 1. Constructs deterministic unique signalKey
   * 2. Reserves capital & risk under account lock
   * 3. Dispatches order to broker simulator
   * 4. Reconciles fill, adjusts reservation, and broadcasts updates
   */
  public async executeApprovedProposal(
    proposalId: string,
    options: { simulatedPartialFill?: boolean } = {},
  ): Promise<{ orderId: string; status: OrderStatus; message: string }> {
    const proposal = this.proposalsService.getProposal(proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal '${proposalId}' not found.`);
    }

    // Generate unique signal bar intent key
    const candleTime = proposal.evidence.indicators?.closedBars || Date.now();
    const signalKey = `${proposal.strategyId}:${proposal.instrumentKey}:5m:${candleTime}`;

    // 1. Acquire Central Capital & Risk Reservation
    const reservation = this.reservationManager.acquireReservation({
      proposalId: proposal.id,
      signalKey,
      instrumentKey: proposal.instrumentKey,
      capitalRequired: proposal.estimatedCapitalRequired,
      allInRisk: proposal.allInMaxLoss,
    });

    try {
      // 2. Dispatch to Broker Adapter
      const ack = await this.broker.placeOrder({
        intentId: reservation.id,
        tag: `SIG_${proposal.strategyVersion}`,
        instrumentKey: proposal.instrumentKey,
        side: proposal.side,
        orderType: OrderType.LIMIT,
        product: proposal.product,
        quantity: proposal.quantity,
        price: proposal.suggestedEntryPrice,
        stopLossPrice: proposal.suggestedStopPrice,
        targetPrice: proposal.suggestedTargetPrice,
        estimatedCharges: proposal.estimatedRoundTripCosts,
        simulatedPartialFill: options.simulatedPartialFill,
      });

      if (ack.status === 'REJECTED') {
        // Release reservation back to available cash
        this.reservationManager.releaseReservation(reservation.id, ack.message);
        return {
          orderId: ack.orderId,
          status: OrderStatus.REJECTED,
          message: ack.message,
        };
      }

      // 3. Commit Reservation to Open Position
      this.reservationManager.commitReservationToPosition(
        reservation.id,
        proposal.estimatedCapitalRequired,
      );

      this.gateway.broadcast('order.executed', {
        orderId: ack.orderId,
        status: options.simulatedPartialFill ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED,
      });

      return {
        orderId: ack.orderId,
        status: options.simulatedPartialFill ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED,
        message: 'Order executed successfully in paper simulation.',
      };
    } catch (err: any) {
      this.logger.error(`[OrdersService] Execution failed: ${err.message}`);
      this.reservationManager.releaseReservation(reservation.id, err.message);
      throw new BadRequestException(`Order execution failed: ${err.message}`);
    }
  }

  /**
   * Closes an existing open position at current market price.
   */
  public async closePosition(
    instrumentKey: string,
  ): Promise<{ success: boolean; message: string }> {
    const positions = await this.broker.getPositions();
    const position = positions.find((p) => p.instrumentKey === instrumentKey);
    if (!position || position.netQuantity <= 0) {
      throw new NotFoundException(`No open position found for instrument '${instrumentKey}'.`);
    }

    const ack = await this.broker.placeOrder({
      intentId: `exit_${Date.now()}`,
      tag: 'EXIT_MANUAL',
      instrumentKey: position.instrumentKey,
      side: OrderSide.SELL,
      orderType: OrderType.MARKET,
      product: ProductType.I,
      quantity: position.netQuantity,
    });

    const initialCapital = position.buyAvgPrice * position.netQuantity;
    const estPnl = (position.lastPrice - position.buyAvgPrice) * position.netQuantity - 58.0;
    this.reservationManager.settleClosedPosition(
      `pos_${instrumentKey}`,
      initialCapital,
      estPnl,
    );

    return {
      success: true,
      message: `Position closed successfully. Order: ${ack.orderId}.`,
    };
  }
}
