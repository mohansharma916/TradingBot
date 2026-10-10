import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { useWorkstation, WorkstationProvider } from '../hooks/useWorkstation';
import { RiskState, TradeMode, TradingModeSnapshot } from '@trading-bot/contracts';

const api = vi.hoisted(() => ({
  setAuthToken: vi.fn(), login: vi.fn(), logout: vi.fn(), getMe: vi.fn(),
  getTradingMode: vi.fn(), selectTradingMode: vi.fn(), getRiskStatus: vi.fn(),
  armRisk: vi.fn(), disarmRisk: vi.fn(), resetKillSwitch: vi.fn(),
  emergencyStop: vi.fn(), flattenPositions: vi.fn(),
}));
vi.mock('../services/api', () => ({ apiClient: api }));
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(WorkstationProvider, null, children);
const testing: TradingModeSnapshot = {
  mode: TradeMode.PAPER, label: 'TESTING', liveExecutionEnabled: false, error: null,
  funds: { availableCash: 7000, reservedMargin: 3000, totalCapital: 10000,
    source: 'PAPER_SIMULATION', status: 'VERIFIED', verifiedAt: '2026-10-12T04:00:00Z' },
};
const risk = { state: RiskState.DISARMED, egressIpVerified: false, realizedNetDailyPnl: 0,
  dailyLossCap: 600, maxAllInTradeLoss: 200, dailyTargetProfit: 4000,
  openPositionsCount: 1, reservedCapital: 3000 };

beforeEach(() => {
  vi.resetAllMocks(); window.sessionStorage.clear();
  api.login.mockResolvedValue({ token: 'owner-session', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  api.getTradingMode.mockResolvedValue(testing);
  api.getRiskStatus.mockResolvedValue(risk);
  api.getMe.mockResolvedValue({ id: 'owner' });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); });

async function authenticate(result: { current: ReturnType<typeof useWorkstation> }) {
  await act(async () => { await result.current.login('owner', 'password-from-owner'); });
  await waitFor(() => expect(result.current.state.isLiveSynced).toBe(true));
}

describe('Shared authenticated workstation', () => {
  it('requires owner login and does not invent capital or call protected APIs before login', () => {
    const { result } = renderHook(useWorkstation, { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.mode).toBe(TradeMode.PAPER);
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
    expect(result.current.state.totalCapital).toBe(0);
    expect(result.current.state.egressIpVerified).toBe(false);
    expect(api.getTradingMode).not.toHaveBeenCalled();
    expect(api.getRiskStatus).not.toHaveBeenCalled();
  });

  it('shares a confirmed account selection and actual broker funds across consumers', async () => {
    const { result } = renderHook(() => ({ first: useWorkstation(), second: useWorkstation() }), { wrapper });
    await act(async () => { await result.current.first.login('owner', 'password'); });
    await waitFor(() => expect(result.current.first.state.availableCash).toBe(7000));
    const live: TradingModeSnapshot = { ...testing, mode: TradeMode.APPROVAL, label: 'LIVE', liveExecutionEnabled: true,
      funds: { ...testing.funds, availableCash: 4567.89, totalCapital: 4567.89, reservedMargin: 0, source: 'LIVE_BROKER' } };
    api.selectTradingMode.mockResolvedValue(live); api.getTradingMode.mockResolvedValue(live);
    await act(async () => { await result.current.first.selectMode(TradeMode.APPROVAL); });
    expect(result.current.second.state.mode).toBe(TradeMode.APPROVAL);
    expect(result.current.second.state.availableCash).toBe(4567.89);
    expect(result.current.second.snapshot?.funds.source).toBe('LIVE_BROKER');
  });

  it('keeps Testing selected and shows the server error when Live is rejected', async () => {
    const { result } = renderHook(useWorkstation, { wrapper }); await authenticate(result);
    api.selectTradingMode.mockRejectedValue(new Error('Enable LIVE_EXECUTION_ENABLED and verify Upstox funds.'));
    await act(async () => { expect(await result.current.selectMode(TradeMode.APPROVAL)).toBeNull(); });
    expect(result.current.state.mode).toBe(TradeMode.PAPER);
    expect(result.current.snapshot?.funds.source).toBe('PAPER_SIMULATION');
    expect(result.current.error).toContain('LIVE_EXECUTION_ENABLED');
  });

  it('preserves confirmed exposure and reports failure when flatten cannot be confirmed', async () => {
    const { result } = renderHook(useWorkstation, { wrapper }); await authenticate(result);
    api.flattenPositions.mockRejectedValue(new Error('Broker unavailable'));
    await act(async () => { expect(await result.current.flattenPositions()).toBeNull(); });
    expect(result.current.state.openPositionsCount).toBe(1);
    expect(result.current.state.activeReservationsCount).toBe(1);
    expect(result.current.state.availableCash).toBe(7000);
    expect(result.current.error).toBe('Broker unavailable');
  });

  it('never reports a successful emergency stop or arms risk after an API failure', async () => {
    const { result } = renderHook(useWorkstation, { wrapper }); await authenticate(result);
    api.emergencyStop.mockResolvedValue({ success: false, message: 'Stop not confirmed' });
    await act(async () => { expect(await result.current.emergencyStop()).toBeNull(); });
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
    expect(result.current.error).toBe('Stop not confirmed');
    api.armRisk.mockRejectedValue(new Error('Risk API unavailable'));
    await act(async () => { await result.current.armRisk(); });
    expect(result.current.state.riskState).toBe(RiskState.DISARMED);
  });

  it('marks funds unavailable after refresh failure and clears local authority on logout', async () => {
    const { result } = renderHook(useWorkstation, { wrapper }); await authenticate(result);
    api.getTradingMode.mockRejectedValue(new Error('Funds verification unavailable'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.snapshot?.funds.status).toBe('UNAVAILABLE');
    expect(result.current.state.isLiveSynced).toBe(false);
    api.logout.mockRejectedValue(new Error('API offline'));
    await act(async () => { await result.current.logout(); });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.totalCapital).toBe(0);
    expect(api.setAuthToken).toHaveBeenLastCalledWith(undefined);
    expect(window.sessionStorage.getItem('TRADING_OWNER_SESSION')).toBeNull();
  });
});
