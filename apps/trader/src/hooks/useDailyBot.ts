import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DailyBotConfig, DailyBotControlAction, DailyBotPreflight, DailyBotSetup,
  DailyBotToday, DailyBotSession,
} from '@trading-bot/contracts';
import { apiClient } from '../services/api';

export function useDailyBot() {
  const [today, setToday] = useState<DailyBotToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<DailyBotPreflight | null>(null);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const mutationLock = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await apiClient.getDailyBotToday();
      if (mounted.current && version === requestVersion.current) {
        setToday(result);
        setConnectionError(null);
      }
    } catch (failure) {
      if (mounted.current && version === requestVersion.current) {
        setConnectionError(failure instanceof Error ? failure.message : 'Could not connect to the trading API.');
      }
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => { if (!mutationLock.current) void refresh(); }, 5000);
    return () => { mounted.current = false; ++requestVersion.current; clearInterval(timer); };
  }, [refresh]);

  const mutate = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (mutationLock.current) return null;
    mutationLock.current = true;
    ++requestVersion.current;
    setBusy(true);
    setActionError(null);
    try {
      const result = await operation();
      await refresh();
      return result;
    } catch (failure) {
      if (mounted.current) setActionError(failure instanceof Error ? failure.message : 'The request failed.');
      return null;
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [refresh]);

  const save = useCallback((config: DailyBotConfig) => {
    setPreflight(null);
    return mutate<DailyBotSetup>(() => apiClient.createDailyBotSetup(config));
  }, [mutate]);
  const clone = useCallback((id: string, date: string) => {
    setPreflight(null);
    return mutate<DailyBotSetup>(() => apiClient.cloneDailyBotSetup(id, date));
  }, [mutate]);
  const check = useCallback((id: string) => mutate(async () => {
    const result = await apiClient.preflightDailyBot(id);
    if (mounted.current) setPreflight(result);
    return result;
  }), [mutate]);
  const start = useCallback((id: string, operatorConsent: boolean) => mutate<DailyBotSession>(() =>
    apiClient.startDailyBot(id, { operatorConsent })), [mutate]);
  const control = useCallback((id: string, action: DailyBotControlAction) =>
    mutate<DailyBotSession>(() => apiClient.controlDailyBot(id, action)), [mutate]);

  return { today, loading, busy, error: actionError ?? connectionError, preflight, refresh, save, clone, check, start, control,
    clearPreflight: () => setPreflight(null) };
}
