import { useState, useCallback } from 'react';
import { TradeMode, RiskState } from '@trading-bot/contracts';

export interface WorkstationState {
  mode: TradeMode;
  riskState: RiskState;
  egressIpVerified: boolean;
  totalCapital: number;
  availableCash: number;
  realizedNetDailyPnl: number;
  dailyLossCap: number;
  maxAllInTradeLoss: number;
  targetDailyProfit: number;
}

export function useWorkstation() {
  const [state, setState] = useState<WorkstationState>({
    mode: TradeMode.PAPER,
    riskState: RiskState.DISARMED,
    egressIpVerified: true,
    totalCapital: 10000,
    availableCash: 10000,
    realizedNetDailyPnl: 0,
    dailyLossCap: 1500,
    maxAllInTradeLoss: 500,
    targetDailyProfit: 4000,
  });

  const emergencyStop = useCallback(() => {
    setState((prev) => ({
      ...prev,
      riskState: RiskState.EMERGENCY_STOP,
    }));
  }, []);

  const armRisk = useCallback((_durationMinutes = 60) => {
    setState((prev) => {
      if (prev.riskState === RiskState.EMERGENCY_STOP) {
        alert('Cannot arm: Emergency stop is active. Reset emergency stop first.');
        return prev;
      }
      return {
        ...prev,
        riskState: RiskState.ARMED,
      };
    });
  }, []);

  const disarmRisk = useCallback(() => {
    setState((prev) => ({
      ...prev,
      riskState: RiskState.DISARMED,
    }));
  }, []);

  const resetKillSwitch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      riskState: RiskState.DISARMED,
    }));
  }, []);

  return {
    state,
    emergencyStop,
    armRisk,
    disarmRisk,
    resetKillSwitch,
  };
}
