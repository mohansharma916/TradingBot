import { Injectable, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { RiskState, RiskStatus, TradeMode } from '@trading-bot/contracts';

@Injectable()
export class RiskService {
  private currentState: RiskState;
  private currentMode: TradeMode;
  private armedUntil: string | null = null;
  private killSwitchActive = false;

  private realizedNetDailyPnl = 0;
  private unrealizedDailyPnl = 0;
  private reservedCapital = 0;
  private openPositionsCount = 0;

  constructor(@Inject(EnvService) private readonly envService: EnvService) {
    this.currentState = this.envService.config.DEFAULT_RISK_STATE;
    this.currentMode = this.envService.config.SYSTEM_MODE;
  }

  public getStatus(): RiskStatus {
    const cfg = this.envService.config;
    const remainingBudget = Math.max(
      0,
      cfg.MAX_DAILY_DRAWDOWN_INR - Math.max(0, -this.realizedNetDailyPnl) - this.reservedCapital,
    );

    return {
      mode: this.currentMode,
      state: this.currentState,
      totalCapital: cfg.MAX_ACCOUNT_CAPITAL_INR,
      availableCash: cfg.MAX_ACCOUNT_CAPITAL_INR - this.reservedCapital,
      reservedCapital: this.reservedCapital,
      maxAllInTradeLoss: cfg.MAX_ALL_IN_TRADE_RISK_INR,
      dailyLossCap: cfg.MAX_DAILY_DRAWDOWN_INR,
      realizedNetDailyPnl: this.realizedNetDailyPnl,
      unrealizedDailyPnl: this.unrealizedDailyPnl,
      remainingDailyRiskBudget: remainingBudget,
      openPositionsCount: this.openPositionsCount,
      maxOpenPositions: 1,
      dailyTargetProfit: cfg.TARGET_DAILY_PROFIT_INR,
      armedUntil: this.armedUntil,
      killSwitchActive: this.killSwitchActive,
      egressIpVerified: true,
    };
  }

  public arm(durationMinutes: number): RiskStatus {
    if (this.killSwitchActive) {
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
    this.killSwitchActive = true;
    this.currentState = RiskState.EMERGENCY_STOP;
    this.armedUntil = null;
    return {
      success: true,
      message: 'Emergency Stop Activated: All new entries blocked and system frozen.',
    };
  }
}
