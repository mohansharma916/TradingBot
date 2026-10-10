import { Injectable, Inject, Logger } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import {
  RiskState,
  RiskStatus,
  TradeMode,
  OrderSide,
  OrderType,
  OrderStatus,
  ProductType,
  FlattenPositionsResult,
  FlattenExitDetail,
} from '@trading-bot/contracts';
import { calculateOptionCharges } from '@trading-bot/domain';
import { RiskReservationManager } from './risk-reservation.manager';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { EventsGateway } from '../websocket/events.gateway';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);
  private currentState: RiskState;
  private currentMode: TradeMode;
  private armedUntil: string | null = null;
  private unrealizedDailyPnl = 0;

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(RiskReservationManager) private readonly reservationManager: RiskReservationManager,
    @Inject(PaperBrokerAdapter) private readonly paperBroker?: PaperBrokerAdapter,
    @Inject(UpstoxBrokerAdapter) private readonly upstoxBroker?: UpstoxBrokerAdapter,
    @Inject(EventsGateway) private readonly gateway?: EventsGateway,
  ) {
    this.currentState = this.envService.config.DEFAULT_RISK_STATE;
    this.currentMode = this.envService.config.SYSTEM_MODE;
  }

  private getBroker() {
    return this.currentMode === TradeMode.PAPER
      ? this.paperBroker
      : this.upstoxBroker;
  }

  public getStatus(): RiskStatus {
    const cfg = this.envService.config;
    const reservedCapital = this.reservationManager.getTotalReservedCapital();
    const availableCash = this.reservationManager.getAvailableCash();
    const remainingBudget = this.reservationManager.getRemainingDailyRiskBudget();
    const killSwitch = this.reservationManager.isKillSwitchActive();

    return {
      mode: this.currentMode,
      state: killSwitch ? RiskState.EMERGENCY_STOP : this.currentState,
      totalCapital: cfg.MAX_ACCOUNT_CAPITAL_INR,
      availableCash,
      reservedCapital,
      maxAllInTradeLoss: cfg.MAX_ALL_IN_TRADE_RISK_INR,
      dailyLossCap: cfg.MAX_DAILY_DRAWDOWN_INR,
      realizedNetDailyPnl: this.reservationManager.getRealizedNetDailyPnl(),
      unrealizedDailyPnl: this.unrealizedDailyPnl,
      remainingDailyRiskBudget: remainingBudget,
      openPositionsCount: this.reservationManager.getOpenPositionsCount(),
      maxOpenPositions: 1,
      dailyTargetProfit: cfg.TARGET_DAILY_PROFIT_INR,
      armedUntil: this.armedUntil,
      killSwitchActive: killSwitch,
      egressIpVerified: true,
    };
  }

  public arm(durationMinutes: number): RiskStatus {
    if (this.reservationManager.isKillSwitchActive()) {
      throw new Error('Cannot arm when kill switch is active. Reset kill switch first.');
    }
    this.currentState = RiskState.ARMED;
    this.armedUntil = new Date(Date.now() + durationMinutes * 60000).toISOString();
    this.gateway?.broadcast('risk.armed', { state: this.currentState, armedUntil: this.armedUntil });
    return this.getStatus();
  }

  public disarm(): RiskStatus {
    this.currentState = RiskState.DISARMED;
    this.armedUntil = null;
    this.gateway?.broadcast('risk.disarmed', { state: this.currentState });
    return this.getStatus();
  }

  public triggerEmergencyStop(): { success: boolean; message: string } {
    this.reservationManager.setKillSwitch(true);
    this.currentState = RiskState.EMERGENCY_STOP;
    this.armedUntil = null;
    this.gateway?.broadcast('risk.emergency_stop', {
      state: RiskState.EMERGENCY_STOP,
      killSwitchActive: true,
      message: 'Emergency Stop Activated: Kill switch engaged, all new trade entries blocked.',
    });
    return {
      success: true,
      message: 'Emergency Stop Activated: Kill switch engaged, new entries blocked.',
    };
  }

  public resetKillSwitch(): RiskStatus {
    this.reservationManager.setKillSwitch(false);
    this.currentState = RiskState.DISARMED;
    this.armedUntil = null;
    this.gateway?.broadcast('risk.reset', { state: RiskState.DISARMED, killSwitchActive: false });
    return this.getStatus();
  }

  /**
   * Request Flatten All Positions:
   * Explicitly closes open positions at market, records exits, settles reservations, and sets DISARMED.
   * Reference: Blueprint Section 8 & Phase 6
   */
  public async flattenPositions(reason = 'Operator Manual Flatten'): Promise<FlattenPositionsResult> {
    const broker = this.getBroker();
    if (!broker) {
      throw new Error('No broker adapter configured to execute flatten exit orders.');
    }
    const positions = await broker.getPositions();
    const activePositions = positions.filter((p) => p.netQuantity > 0);

    if (activePositions.length === 0) {
      this.currentState = RiskState.DISARMED;
      this.armedUntil = null;
      this.unrealizedDailyPnl = 0;
      return {
        success: true,
        positionsClosed: 0,
        exitOrders: [],
        totalRealizedNetPnl: 0,
        totalActualCharges: 0,
        message: 'No open positions to flatten. Portfolio is flat. System DISARMED.',
        disclaimer: 'Exits submitted as market orders; confirmed broker fill events finalize closed ledger state.',
      };
    }

    const exitOrders: FlattenExitDetail[] = [];
    let totalRealizedNetPnl = 0;
    let totalActualCharges = 0;

    for (const pos of activePositions) {
      // Submit explicit market sell order to broker
      const ack = await broker.placeOrder({
        intentId: `intent_flatten_${Date.now()}_${pos.instrumentKey}`,
        tag: 'FLATTEN_ALL',
        instrumentKey: pos.instrumentKey,
        side: OrderSide.SELL,
        orderType: OrderType.MARKET,
        product: ProductType.I,
        quantity: pos.netQuantity,
      });

      const confirmed = ack.status === 'REJECTED' ? undefined : (await broker.getOrders()).find((order) => order.id === ack.orderId && order.filledQuantity === pos.netQuantity && order.averageFillPrice > 0);
      if (!confirmed) {
        exitOrders.push({ orderId: ack.orderId, instrumentKey: pos.instrumentKey, symbol: pos.symbol, quantity: pos.netQuantity, exitPrice: 0, realizedPnl: 0, charges: 0, status: ack.status === 'REJECTED' ? OrderStatus.REJECTED : OrderStatus.ACKNOWLEDGED });
        continue;
      }
      const exitPrice = confirmed.averageFillPrice;
      const charges = calculateOptionCharges({ buyPrice: pos.buyAvgPrice, sellPrice: exitPrice, quantity: pos.netQuantity });
      const paperExit = broker instanceof PaperBrokerAdapter ? broker.getConfirmedExit(ack.orderId, pos.buyAvgPrice, pos.netQuantity) : undefined;
      if (paperExit) charges.totalRoundTripCharges = paperExit.charges;
      const netPnl = paperExit?.netPnl ?? Number(((exitPrice - pos.buyAvgPrice) * pos.netQuantity - charges.totalRoundTripCharges).toFixed(2));
      totalRealizedNetPnl += netPnl;
      totalActualCharges += charges.totalRoundTripCharges;

      // Settle reservation in risk reservation manager
      const activeReservation = this.reservationManager
        .getActiveReservations()
        .find((r) => r.instrumentKey === pos.instrumentKey);

      if (activeReservation) {
        if (activeReservation.status === 'COMMITTED') this.reservationManager.settleReservation(activeReservation.id, netPnl);
        else this.reservationManager.settleClosedPosition(
          activeReservation.signalKey,
          activeReservation.reservedCapital,
          netPnl,
        );
      }

      exitOrders.push({
        orderId: ack.orderId,
        instrumentKey: pos.instrumentKey,
        symbol: pos.symbol,
        quantity: pos.netQuantity,
        exitPrice,
        realizedPnl: netPnl,
        charges: charges.totalRoundTripCharges,
        status: OrderStatus.CLOSED,
      });

      this.gateway?.broadcast('position.flattened', {
        instrumentKey: pos.instrumentKey,
        quantity: pos.netQuantity,
        exitPrice,
        netPnl,
      });
    }

    // Always disarm on flatten to maintain safety discipline
    this.currentState = RiskState.DISARMED;
    this.armedUntil = null;
    this.unrealizedDailyPnl = 0;

    this.logger.warn(
      `[RiskService] Flattened ${exitOrders.length} position(s). Reason: '${reason}'. Total Net P&L: ₹${totalRealizedNetPnl.toFixed(2)}.`,
    );

    return {
      success: exitOrders.every((order) => order.status === OrderStatus.CLOSED),
      positionsClosed: exitOrders.filter((order) => order.status === OrderStatus.CLOSED).length,
      exitOrders,
      totalRealizedNetPnl: Number(totalRealizedNetPnl.toFixed(2)),
      totalActualCharges: Number(totalActualCharges.toFixed(2)),
      message: `${exitOrders.filter((order) => order.status === OrderStatus.CLOSED).length} confirmed closed position(s); ${exitOrders.filter((order) => order.status !== OrderStatus.CLOSED).length} exit(s) pending or rejected. Reason: '${reason}'. System DISARMED.`,
      disclaimer: 'Exits submitted as market orders; confirmed broker fill events finalize closed ledger state.',
    };
  }
}
