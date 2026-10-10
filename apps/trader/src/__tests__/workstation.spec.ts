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
    expect(result.current.state.openPositionsCount).toBe(1);
    expect(result.current.state.activeReservationsCount).toBe(1);
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

  it('emergency stop triggers EMERGENCY_STOP state and resetKillSwitch restores DISARMED', () => {
    const { result } = renderHook(() => useWorkstation());

    act(() => {
      result.current.emergencyStop();
    });
    expect(result.current.state.riskState).toBe(RiskState.EMERGENCY_STOP);

    act(() => {
      result.current.resetKillSwitch();
    });
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
  });

  it('flattenPositions closes positions at market and restores DISARMED state', async () => {
    const { result } = renderHook(() => useWorkstation());

    expect(result.current.state.openPositionsCount).toBe(1);

    let res: any;
    await act(async () => {
      res = await result.current.flattenPositions('Manual operator drill');
    });

    expect(res.success).toBe(true);
    expect(res.positionsClosed).toBe(1);
    expect(res.message).toContain('DISARMED');
    expect(result.current.state.openPositionsCount).toBe(0);
    expect(result.current.state.activeReservationsCount).toBe(0);
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
  });
});
