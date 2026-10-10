import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { BrokerRouterService } from '../broker/broker-router.service';
import { TradingModeService } from '../trading/trading-mode.service';
import { OrdersService } from '../orders/orders.service';
import { EnvService } from '../config/env.service';
import {
  RiskState,
  RiskStatus,
  TradeMode,
  OrderStatus,
  FlattenPositionsResult,
  FlattenExitDetail,
} from '@trading-bot/contracts';
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
    @Optional() @Inject(BrokerRouterService) private readonly router?: BrokerRouterService,
    @Optional() @Inject(TradingModeService) private readonly tradingMode?: TradingModeService,
    @Optional() @Inject(OrdersService) private readonly ordersService?: OrdersService,
  ) {
    this.currentState = this.envService.config.DEFAULT_RISK_STATE;
    this.currentMode = this.envService.config.SYSTEM_MODE;
  }

  private getBroker() {
    if (this.router) return this.router;
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
      mode: this.tradingMode?.getMode() ?? this.currentMode,
      state: killSwitch ? RiskState.EMERGENCY_STOP : this.reservationManager.isArmed() ? RiskState.ARMED : RiskState.DISARMED,
      totalCapital: this.tradingMode?.isLive() ? this.tradingMode.getSnapshot().funds.totalCapital : this.reservationManager.getTotalAccountCapital(),
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
      armedUntil: this.reservationManager.getArmedUntil(),
      killSwitchActive: killSwitch,
      egressIpVerified: false,
      fundsSource: this.tradingMode?.getSnapshot().funds.source ?? 'PAPER_SIMULATION',
      fundsVerifiedAt: this.tradingMode?.getSnapshot().funds.verifiedAt ?? null,
    };
  }

  public arm(durationMinutes: number): RiskStatus {
    this.reservationManager.arm(durationMinutes);
    if (this.reservationManager.isKillSwitchActive()) {
      throw new Error('Cannot arm when kill switch is active. Reset kill switch first.');
    }
    this.currentState = RiskState.ARMED;
    this.armedUntil = new Date(Date.now() + durationMinutes * 60000).toISOString();
    this.gateway?.broadcast('risk.armed', { state: this.currentState, armedUntil: this.armedUntil });
    return this.getStatus();
  }

  public disarm(): RiskStatus {
    this.reservationManager.disarm();
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
    this.reservationManager.disarm();
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
      if (!this.ordersService) throw new Error('The shared owned-position exit service is unavailable.');
      const result = await this.ordersService.closePosition(pos.instrumentKey);
      const confirmed = result.success && result.status === OrderStatus.CLOSED;
      exitOrders.push({
        orderId: result.orderId ?? '', instrumentKey: pos.instrumentKey, symbol: pos.symbol,
        quantity: result.quantity ?? pos.netQuantity, exitPrice: result.exitPrice ?? 0,
        realizedPnl: confirmed ? result.netPnl ?? 0 : 0, charges: confirmed ? result.charges ?? 0 : 0,
        status: result.status ?? OrderStatus.UNKNOWN_BROKER_STATE,
      });
      if (confirmed) {
        totalRealizedNetPnl += result.netPnl ?? 0;
        totalActualCharges += result.charges ?? 0;
      }
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
