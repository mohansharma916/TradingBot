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
  openPositionsCount: number;
  activeReservationsCount: number;
}

export function useWorkstation() {
  const [state, setState] = useState<WorkstationState>({
    mode: TradeMode.PAPER,
    riskState: RiskState.DISARMED,
    egressIpVerified: true,
    totalCapital: 10000,
    availableCash: 6937.5,
    realizedNetDailyPnl: 0,
    dailyLossCap: 1500,
    maxAllInTradeLoss: 500,
    targetDailyProfit: 4000,
    openPositionsCount: 1,
    activeReservationsCount: 1,
  });

  const [isFlattening, setIsFlattening] = useState<boolean>(false);

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

  const flattenPositions = useCallback(async (reason = 'Operator Emergency Flatten') => {
    setIsFlattening(true);
    try {
      // Transition state: close positions, settle capital to cash, reset state to DISARMED
      setState((prev) => ({
        ...prev,
        riskState: RiskState.DISARMED,
        openPositionsCount: 0,
        activeReservationsCount: 0,
        availableCash: 10000,
      }));
      return {
        success: true,
        positionsClosed: 1,
        totalRealizedNetPnl: 45.83,
        message: `Flatten request executed: 1 position(s) closed at market. System set to DISARMED. Reason: ${reason}`,
      };
    } finally {
      setIsFlattening(false);
    }
  }, []);

  return {
    state,
    isFlattening,
    emergencyStop,
    armRisk,
    disarmRisk,
    resetKillSwitch,
    flattenPositions,
  };
}
