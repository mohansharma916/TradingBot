import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkstation } from '../hooks/useWorkstation.ts';
import { RiskState, TradeMode } from '@trading-bot/contracts';

describe('useWorkstation Hook', () => {
  it('defaults to PAPER mode and DISARMED risk state', () => {
    const { result } = renderHook(() => useWorkstation());
    expect(result.current.state.mode).toBe(TradeMode.PAPER);
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
    expect(result.current.state.totalCapital).toBe(10000);
  });

  it('arms and disarms risk safely', () => {
    const { result } = renderHook(() => useWorkstation());

    act(() => {
      result.current.armRisk(30);
    });
    expect(result.current.state.riskState).toBe(RiskState.ARMED);

    act(() => {
      result.current.disarmRisk();
    });
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
  });

  it('emergency stop triggers EMERGENCY_STOP state', () => {
    const { result } = renderHook(() => useWorkstation());

    act(() => {
      result.current.emergencyStop();
    });
    expect(result.current.state.riskState).toBe(RiskState.EMERGENCY_STOP);
  });
});
