import { createContext, createElement, useState, useCallback, useEffect, useContext, useRef, ReactNode } from 'react';
import { TradeMode, RiskState, RiskStatus, TradingModeSnapshot, FlattenPositionsResult } from '@trading-bot/contracts';
import { apiClient } from '../services/api';
import { formatErrorMessage } from '@trading-bot/client-sdk';

export interface WorkstationState {
  mode: TradeMode; riskState: RiskState; egressIpVerified: boolean;
  totalCapital: number; availableCash: number; realizedNetDailyPnl: number;
  dailyLossCap: number; maxAllInTradeLoss: number; targetDailyProfit: number;
  openPositionsCount: number; activeReservationsCount: number; isLiveSynced: boolean;
}
const initialState: WorkstationState = {
  mode: TradeMode.PAPER, riskState: RiskState.DISARMED, egressIpVerified: false,
  totalCapital: 0, availableCash: 0, realizedNetDailyPnl: 0, dailyLossCap: 0,
  maxAllInTradeLoss: 0, targetDailyProfit: 0, openPositionsCount: 0, activeReservationsCount: 0, isLiveSynced: false,
};
const storageKey = 'TRADING_OWNER_SESSION';
function savedSession(): { token: string; expiresAt: string } | null {
  try {
    const value = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    const session = value ? JSON.parse(value) : null;
    return session?.token && Date.parse(session.expiresAt) > Date.now() ? session : null;
  } catch { return null; }
}
function storeSession(session: { token: string; expiresAt: string } | null): void {
  try {
    if (typeof window !== 'undefined') {
      if (session) window.sessionStorage.setItem(storageKey, JSON.stringify(session));
      else window.sessionStorage.removeItem(storageKey);
    }
  } catch { /* A browser that blocks storage keeps the session in memory. */ }
}
const message = (error: unknown) => formatErrorMessage(error) || 'The trading API could not confirm this request.';

function useWorkstationController() {
  const [state, setState] = useState<WorkstationState>(initialState);
  const [snapshot, setSnapshot] = useState<TradingModeSnapshot | null>(null);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const revision = useRef(0);

  const clearSession = useCallback(() => {
    revision.current += 1;
    apiClient.setAuthToken(undefined); storeSession(null);
    setAuthenticated(false); setSnapshot(null); setState(initialState);
  }, []);

  const applyRiskStatus = useCallback((risk: RiskStatus, mode: TradingModeSnapshot) => {
    setState({ mode: mode.mode, riskState: risk.state, egressIpVerified: risk.egressIpVerified,
      totalCapital: mode.funds.totalCapital, availableCash: mode.funds.availableCash,
      realizedNetDailyPnl: risk.realizedNetDailyPnl, dailyLossCap: risk.dailyLossCap,
      maxAllInTradeLoss: risk.maxAllInTradeLoss, targetDailyProfit: risk.dailyTargetProfit,
      openPositionsCount: risk.openPositionsCount, activeReservationsCount: risk.reservedCapital > 0 ? 1 : 0,
      isLiveSynced: true });
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    const currentRevision = revision.current;
    try {
      const [mode, risk] = await Promise.all([apiClient.getTradingMode(), apiClient.getRiskStatus()]);
      if (currentRevision !== revision.current) return;
      setSnapshot(mode); applyRiskStatus(risk, mode); setError(mode.error);
    } catch (failure) {
      if (currentRevision !== revision.current) return;
      setError(message(failure)); setState((current) => ({ ...current, isLiveSynced: false }));
      setSnapshot((current) => current ? { ...current, funds: { ...current.funds, availableCash: 0, status: 'UNAVAILABLE', source: 'UNAVAILABLE', verifiedAt: null } } : null);
      if ((failure as any)?.status === 401 || (failure as any)?.statusCode === 401 || String(failure).includes('401')) clearSession();
    }
  }, [isAuthenticated, applyRiskStatus, clearSession]);

  useEffect(() => {
    let active = true;
    const session = savedSession();
    if (!session) { setCheckingSession(false); return; }
    apiClient.setAuthToken(session.token);
    void apiClient.getMe().then(() => { if (active) setAuthenticated(true); })
      .catch((failure) => { if (active) { clearSession(); setError(message(failure)); } })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [clearSession]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refresh(); const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [isAuthenticated, refresh]);

  const login = useCallback(async (username: string, password: string) => {
    setPending('login'); setError(null);
    try { const session = await apiClient.login(username, password); storeSession(session); setAuthenticated(true); }
    catch (failure) { clearSession(); setError(message(failure)); }
    finally { setPending(null); }
  }, [clearSession]);

  const logout = useCallback(async () => {
    setPending('logout');
    try { await apiClient.logout(); setError(null); }
    catch (failure) { setError(`Signed out locally. Server session revocation was not confirmed: ${message(failure)}`); }
    finally { clearSession(); setPending(null); }
  }, [clearSession]);

  const perform = useCallback(async <T,>(label: string, operation: () => Promise<T>): Promise<T | null> => {
    if (mutationLock.current || !isAuthenticated) return null;
    mutationLock.current = true;
    setPending(label); setError(null);
    try { const result = await operation(); await refresh(); return result; }
    catch (failure) { setError(message(failure)); return null; }
    finally { mutationLock.current = false; setPending(null); }
  }, [isAuthenticated, refresh]);

  const selectMode = useCallback((mode: TradeMode.PAPER | TradeMode.APPROVAL) => perform('mode', async () => {
    const selected = await apiClient.selectTradingMode(mode); revision.current += 1; setSnapshot(selected);
    setState((current) => ({ ...current, mode: selected.mode, availableCash: selected.funds.availableCash, totalCapital: selected.funds.totalCapital }));
    return selected;
  }), [perform]);
  const emergencyStop = useCallback(() => perform('emergency-stop', async () => {
    const result = await apiClient.emergencyStop(); if (!result.success) throw new Error(result.message); return result;
  }), [perform]);
  const armRisk = useCallback((duration = 60) => perform('arm', () => apiClient.armRisk(duration)), [perform]);
  const disarmRisk = useCallback(() => perform('disarm', () => apiClient.disarmRisk()), [perform]);
  const resetKillSwitch = useCallback(() => perform('reset', () => apiClient.resetKillSwitch()), [perform]);
  const flattenPositions = useCallback((_reason?: string): Promise<FlattenPositionsResult | null> => perform('flatten', async () => {
    const result = await apiClient.flattenPositions(); if (!result.success) throw new Error(result.message); return result;
  }), [perform]);

  return { state, snapshot, isAuthenticated, checkingSession, pending, error,
    isFlattening: pending === 'flatten', refresh, login, logout, selectMode,
    emergencyStop, armRisk, disarmRisk, resetKillSwitch, flattenPositions };
}
const WorkstationContext = createContext<ReturnType<typeof useWorkstationController> | null>(null);
export function WorkstationProvider({ children }: { children: ReactNode }) {
  return createElement(WorkstationContext.Provider, { value: useWorkstationController() }, children);
}
export function useWorkstation() {
  const context = useContext(WorkstationContext);
  if (!context) throw new Error('useWorkstation must be used inside WorkstationProvider.');
  return context;
}
