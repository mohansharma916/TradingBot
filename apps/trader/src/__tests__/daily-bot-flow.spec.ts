import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DailyBotConfig, DailyBotConfigSchema, DailyBotSession, DailyBotSessionSchema,
  DailyBotSetup, DailyBotToday, RiskState, StrategyConfigSchema, TradeMode,
} from '@trading-bot/contracts';

const mocks = vi.hoisted(() => ({
  getDailyBotToday: vi.fn(), createDailyBotSetup: vi.fn(), cloneDailyBotSetup: vi.fn(),
  preflightDailyBot: vi.fn(), startDailyBot: vi.fn(), controlDailyBot: vi.fn(),
  push: vi.fn(), emergencyStop: vi.fn(), width: 1200, platform: 'web',
}));

vi.mock('../services/api', () => ({ apiClient: mocks }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push }), usePathname: () => '/', Slot: () => null,
}));
vi.mock('react-native', async () => {
  const native = await import('react-native-web');
  return {
    ...native,
    Platform: { ...native.Platform, get OS() { return mocks.platform; } },
    useWindowDimensions: () => ({ width: mocks.width, height: 800, scale: 1, fontScale: 1 }),
  };
});
vi.mock('../hooks/useWorkstation', () => ({
  useWorkstation: () => ({
    state: { mode: TradeMode.PAPER, riskState: RiskState.DISARMED, egressIpVerified: true },
    emergencyStop: mocks.emergencyStop,
  }),
}));

import DailyBotScreen from '../features/daily-bot/DailyBotScreen';
import RootLayout from '../../app/_layout';
import { useDailyBot } from '../hooks/useDailyBot';

const strategy = StrategyConfigSchema.parse({
  id: '550e8400-e29b-41d4-a716-446655440001', name: 'NIFTY EMA20',
});
const otherStrategy = StrategyConfigSchema.parse({
  id: '550e8400-e29b-41d4-a716-446655440002', name: 'BANKNIFTY RSI', underlying: 'BANKNIFTY',
});
const setupId = '550e8400-e29b-41d4-a716-446655440003';
const sessionId = '550e8400-e29b-41d4-a716-446655440004';
const timestamp = '2026-10-12T04:00:00.000Z';
let today: DailyBotToday;

function makeConfig(overrides: Partial<DailyBotConfig> = {}): DailyBotConfig {
  return DailyBotConfigSchema.parse({
    name: 'Morning Setup', tradingDate: '2026-10-12', strategyId: strategy.id,
    dailyCapitalBudget: 10000, dailyMaxLossAllIn: 600, perTradeMaxLossAllIn: 200,
    maxCapitalPerTrade: 10000, ...overrides,
  });
}

function makeSetup(overrides: Partial<DailyBotConfig> = {}): DailyBotSetup {
  return { id: setupId, createdAt: timestamp, clonedFromId: null,
    config: makeConfig(overrides), strategySnapshot: strategy };
}

function makeSession(status: DailyBotSession['status'] = 'RUNNING'): DailyBotSession {
  return DailyBotSessionSchema.parse({
    id: sessionId, setupId, status, config: makeConfig(), strategySnapshot: strategy,
    startedAt: timestamp, stoppedAt: null, lastHeartbeatAt: timestamp,
    lastMessage: 'Waiting for a valid strategy signal.', tradesExecuted: 0,
    pendingProposalId: null, trades: [], events: [],
  });
}

function button(name: string) { return screen.getByRole('button', { name }); }
function input(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
}
function step(name: string) { fireEvent.click(button(name)); }

async function beginSetup() {
  await screen.findByRole('button', { name: 'Create Your First Trading Bot' });
  fireEvent.click(button('Create Your First Trading Bot'));
}

async function saveDefaults() {
  await beginSetup();
  step('Step 6: Review & Start');
  fireEvent.click(button('Save Setup & Check Readiness'));
  await screen.findByText('Ready to Start');
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear();
  }
  // Expo uses an automatic JSX transform; expose React for Vitest's classic TSX transform.
  vi.stubGlobal('React', React);
  mocks.width = 1200; mocks.platform = 'web';
  today = { tradingDate: '2026-10-12', setups: [], todaySetup: null, previousSetup: null,
    activeSession: null, session: null, strategies: [strategy, otherStrategy],
    availableFunds: 10000, supportedModes: [TradeMode.PAPER] };
  mocks.getDailyBotToday.mockImplementation(async () => today);
  mocks.createDailyBotSetup.mockImplementation(async (config: DailyBotConfig) => {
    const setup = { ...makeSetup(), config, strategySnapshot: today.strategies.find((item) => item.id === config.strategyId)! };
    today = { ...today, todaySetup: setup, setups: [...today.setups, setup] };
    return setup;
  });
  mocks.preflightDailyBot.mockResolvedValue({ passed: true, evaluatedAt: timestamp,
    checks: [{ id: 'account', label: 'Available funds', passed: true, message: 'Risk and capital limits are valid.' }] });
  mocks.startDailyBot.mockImplementation(async () => {
    const session = makeSession();
    today = { ...today, activeSession: session, session };
    return session;
  });
  mocks.controlDailyBot.mockImplementation(async (_id: string, action: string) => {
    const status = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'RUNNING' : 'STOPPED';
    const session = makeSession(status);
    today = { ...today, activeSession: status === 'STOPPED' ? null : session, session };
    return session;
  });
});

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Daily Trading Bot setup and execution flow', () => {
  it('shows the first setup action and waits for a saved, checked, authorized session', async () => {
    render(React.createElement(DailyBotScreen));
    await beginSetup();
    expect(button('Manual Approval').getAttribute('aria-disabled')).toBe('true');
    expect(button('Fully Automated').getAttribute('aria-disabled')).toBe('true');
    step('Step 6: Review & Start');
    expect(button('Start Trading Bot').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button('Start Trading Bot'));
    expect(mocks.startDailyBot).not.toHaveBeenCalled();
    expect(screen.getByText('NOT STARTED')).toBeTruthy();
  });

  it('saves the edited wizard settings, checks readiness, and starts only after explicit consent', async () => {
    render(React.createElement(DailyBotScreen));
    await beginSetup();
    input('Setup Name', 'My Edited Session');
    input('Total Trading Fund for Today (₹)', '7500');
    input('Maximum Capital Per Trade (₹)', '3500');
    step('Step 2: Risk Limits');
    input('Maximum Daily Loss (₹)', '500');
    input('Maximum Risk Per Trade (₹)', '175');
    input('Maximum Trades Per Day', '4');
    step('Step 3: Profit Protection');
    input('Net Profit to Activate Trailing (₹)', '350');
    input('Initial Net Profit Protection Target (₹)', '125');
    step('Step 4: Trading Window');
    input('Entry Start (HH:mm IST)', '09:30');
    input('Last Entry (HH:mm IST)', '14:30');
    input('Mandatory Exit (HH:mm IST)', '15:05');
    step('Step 5: Strategy');
    fireEvent.click(screen.getByRole('radio', { name: /BANKNIFTY RSI/ }));
    step('Step 6: Review & Start');
    fireEvent.click(button('Save Setup & Check Readiness'));
    await screen.findByText('Ready to Start');
    expect(mocks.createDailyBotSetup).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My Edited Session', tradingDate: today.tradingDate, tradingMode: TradeMode.PAPER,
      dailyCapitalBudget: 7500, maxCapitalPerTrade: 3500, dailyMaxLossAllIn: 500,
      perTradeMaxLossAllIn: 175, maximumTradesPerDay: 4, minNetProfitToActivateTrailing: 350,
      desiredNetProfitLock: 125, entryStartTime: '09:30', lastEntryTime: '14:30',
      mandatoryExitTime: '15:05', strategyId: otherStrategy.id,
    }));
    expect(mocks.preflightDailyBot).toHaveBeenCalledWith(setupId);
    expect(button('Start Trading Bot').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Authorize this trading session' }));
    fireEvent.click(button('Start Trading Bot'));
    await screen.findByText("Today's Trading Session");
    expect(mocks.startDailyBot).toHaveBeenCalledWith(setupId, { operatorConsent: true });
    expect(screen.queryByRole('button', { name: 'Start Trading Bot' })).toBeNull();
    expect(screen.getAllByText('RUNNING').length).toBeGreaterThan(0);
  });

  it('keeps an invalid risk configuration in the wizard without saving or starting', async () => {
    render(React.createElement(DailyBotScreen));
    await beginSetup();
    step('Step 2: Risk Limits');
    input('Maximum Risk Per Trade (₹)', '700');
    step('Step 6: Review & Start');
    fireEvent.click(button('Save Setup & Check Readiness'));
    expect(screen.getByRole('alert').textContent).toContain('Per-trade loss must not exceed the daily loss budget');
    expect(mocks.createDailyBotSetup).not.toHaveBeenCalled();
    expect(mocks.preflightDailyBot).not.toHaveBeenCalled();
    expect(mocks.startDailyBot).not.toHaveBeenCalled();
  });

  it('reports save failures without claiming a saved setup or running session', async () => {
    mocks.createDailyBotSetup.mockRejectedValueOnce(new Error('Persistence unavailable'));
    render(React.createElement(DailyBotScreen));
    await beginSetup(); step('Step 6: Review & Start');
    fireEvent.click(button('Save Setup & Check Readiness'));
    await screen.findByText('Persistence unavailable');
    expect(mocks.preflightDailyBot).not.toHaveBeenCalled();
    expect(screen.queryByText('Setup saved. You can return to it later, including while the market is closed.')).toBeNull();
    expect(button('Start Trading Bot').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText("Today's Trading Session")).toBeNull();
  });

  it('keeps failed start errors visible after a successful account refresh and does not show running', async () => {
    mocks.startDailyBot.mockRejectedValueOnce(new Error('Market is closed'));
    render(React.createElement(DailyBotScreen));
    await saveDefaults();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Authorize this trading session' }));
    fireEvent.click(button('Start Trading Bot'));
    await screen.findByText('Market is closed');
    fireEvent.click(button('Refresh'));
    await waitFor(() => expect(mocks.getDailyBotToday).toHaveBeenCalledTimes(4));
    expect(screen.getByText('Market is closed')).toBeTruthy();
    expect(screen.queryByText("Today's Trading Session")).toBeNull();
    expect(screen.getByText('SETUP SAVED')).toBeTruthy();
  });

  it('disables start when backend readiness checks fail', async () => {
    mocks.preflightDailyBot.mockResolvedValueOnce({ passed: false, evaluatedAt: timestamp,
      checks: [{ id: 'funds', label: 'Available funds', passed: false, message: 'Insufficient available funds.' }] });
    render(React.createElement(DailyBotScreen));
    await beginSetup(); step('Step 6: Review & Start');
    fireEvent.click(button('Save Setup & Check Readiness'));
    await screen.findByText('Insufficient available funds.');
    expect(screen.getByRole('checkbox', { name: 'Authorize this trading session' }).getAttribute('aria-disabled')).toBe('true');
    expect(button('Start Trading Bot').getAttribute('aria-disabled')).toBe('true');
    expect(mocks.startDailyBot).not.toHaveBeenCalled();
  });

  it('clones a historical setup for the API trading date while preserving its original configuration', async () => {
    const original = makeSetup({ tradingDate: '2026-10-09', name: 'Friday Setup', dailyMaxLossAllIn: 450 });
    const before = structuredClone(original);
    today = { ...today, setups: [original], previousSetup: original };
    mocks.cloneDailyBotSetup.mockImplementationOnce(async (id: string, tradingDate: string) => {
      const clone = { ...original, id: '550e8400-e29b-41d4-a716-446655440005', clonedFromId: id,
        config: { ...original.config, tradingDate } };
      today = { ...today, todaySetup: clone, setups: [...today.setups, clone] };
      return clone;
    });
    render(React.createElement(DailyBotScreen));
    await screen.findByRole('button', { name: 'Choose Older Setup' });
    fireEvent.click(button('Choose Older Setup'));
    fireEvent.click(button('Reuse Setup for Today'));
    await screen.findByRole('button', { name: 'Check Readiness Again' });
    expect(mocks.cloneDailyBotSetup).toHaveBeenCalledWith(original.id, '2026-10-12');
    expect(screen.getByText('Daily Setup · 2026-10-12')).toBeTruthy();
    expect(original).toEqual(before);
    expect(mocks.createDailyBotSetup).not.toHaveBeenCalled();
    fireEvent.click(button('Check Readiness Again'));
    await screen.findByText('Ready to Start');
    expect(mocks.preflightDailyBot).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440005');
  });

  it.each([
    ['RUNNING', 'Pause New Entries', 'pause', 'PAUSED'],
    ['PAUSED', 'Resume Bot', 'resume', 'RUNNING'],
    ['RUNNING', 'Stop New Entries', 'stop', 'STOPPED'],
    ['RUNNING', 'Emergency Stop & Request Exit', 'emergency-stop', 'STOPPED'],
  ] as const)('sends %s session action %s to the backend and displays its returned status', async (initial, label, action, result) => {
    const session = makeSession(initial);
    today = { ...today, activeSession: session, session };
    render(React.createElement(DailyBotScreen));
    await screen.findByRole('button', { name: label });
    fireEvent.click(button(label));
    await waitFor(() => expect(mocks.controlDailyBot).toHaveBeenCalledWith(sessionId, action));
    await waitFor(() => expect(screen.getAllByText(result).length).toBeGreaterThan(0));
  });

  it('approves a pending entry through the session control API', async () => {
    const session = { ...makeSession(), pendingProposalId: 'prop_nifty_0930' };
    today = { ...today, activeSession: session, session };
    render(React.createElement(DailyBotScreen));
    await screen.findByRole('button', { name: 'Approve Entry' });
    fireEvent.click(button('Approve Entry'));
    await waitFor(() => expect(mocks.controlDailyBot).toHaveBeenCalledWith(sessionId, 'approve-entry'));
  });
});

describe('Daily Trading Bot navigation', () => {
  it.each([
    ['web', 1200], ['web', 390], ['ios', 390],
  ] as const)('puts the main feature first and Dashboard last in the rendered %s menu at width %i', (platform, width) => {
    mocks.platform = platform; mocks.width = width;
    render(React.createElement(RootLayout));
    const names = screen.getAllByRole('button').map((element) => element.getAttribute('aria-label')).filter((name) => name !== 'Emergency freeze' && name !== null);
    expect(names[0]).toBe('Daily Trading Bot');
    expect(names[names.length - 1]).toBe('Dashboard');
    fireEvent.click(button('Daily Trading Bot'));
    expect(mocks.push).toHaveBeenLastCalledWith('/');
    fireEvent.click(button('Dashboard'));
    expect(mocks.push).toHaveBeenLastCalledWith('/dashboard');
  });
});

describe('Daily Trading Bot API synchronization', () => {
  it('ignores an earlier account poll that returns after a confirmed setup save', async () => {
    const staleToday = { ...today };
    let finishInitialPoll!: (value: DailyBotToday) => void;
    mocks.getDailyBotToday.mockImplementationOnce(() => new Promise<DailyBotToday>((resolve) => { finishInitialPoll = resolve; }));
    const { result } = renderHook(() => useDailyBot());
    await act(async () => { await result.current.save(makeConfig()); });
    expect(result.current.today?.todaySetup?.id).toBe(setupId);
    await act(async () => { finishInitialPoll(staleToday); });
    expect(result.current.today?.todaySetup?.id).toBe(setupId);
    expect(result.current.today?.setups).toHaveLength(1);
  });

  it('locks overlapping start requests until the first backend response completes', async () => {
    let finishStart!: (session: DailyBotSession) => void;
    mocks.startDailyBot.mockImplementationOnce(() => new Promise<DailyBotSession>((resolve) => { finishStart = resolve; }));
    const { result } = renderHook(() => useDailyBot());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let firstRequest!: Promise<DailyBotSession | null>;
    act(() => { firstRequest = result.current.start(setupId, true); });
    expect(result.current.busy).toBe(true);
    await act(async () => { expect(await result.current.start(setupId, true)).toBeNull(); });
    expect(mocks.startDailyBot).toHaveBeenCalledTimes(1);
    await act(async () => { finishStart(makeSession()); await firstRequest; });
    expect(result.current.busy).toBe(false);
  });
});
