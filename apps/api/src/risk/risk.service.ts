import { Injectable, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { RiskState, RiskStatus, TradeMode } from '@trading-bot/contracts';
import { RiskReservationManager } from './risk-reservation.manager';

@Injectable()
export class RiskService {
  private currentState: RiskState;
  private currentMode: TradeMode;
  private armedUntil: string | null = null;
  private unrealizedDailyPnl = 0;

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(RiskReservationManager) private readonly reservationManager: RiskReservationManager,
  ) {
    this.currentState = this.envService.config.DEFAULT_RISK_STATE;
    this.currentMode = this.envService.config.SYSTEM_MODE;
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
      realizedNetDailyPnl: 0,
      unrealizedDailyPnl: this.unrealizedDailyPnl,
      remainingDailyRiskBudget: remainingBudget,
      openPositionsCount: this.reservationManager.getHeldReservationsCount(),
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
    return this.getStatus();
  }

  public disarm(): RiskStatus {
    this.currentState = RiskState.DISARMED;
    this.armedUntil = null;
    return this.getStatus();
  }

  public triggerEmergencyStop(): { success: boolean; message: string } {
    this.reservationManager.setKillSwitch(true);
    this.currentState = RiskState.EMERGENCY_STOP;
    this.armedUntil = null;
    return {
      success: true,
      message: 'Emergency Stop Activated: Kill switch engaged, new entries blocked.',
    };
  }
}
