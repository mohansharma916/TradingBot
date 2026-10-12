import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GoLiveChecklist } from '@trading-bot/contracts';

const api = vi.hoisted(() => ({ getGoLiveChecklist: vi.fn(), signOffChecklistItem: vi.fn(), signOffGoLiveChecklist: vi.fn(),
  getDiagnostics: vi.fn(), getUpstoxSession: vi.fn(), getReconciliationReport: vi.fn(), getReconciliationSchedule: vi.fn(), getAlerts: vi.fn() }));
vi.mock('../services/api', () => ({ apiClient: api }));
import LiveChecklistReview from '../features/health/LiveChecklistReview';
import HealthScreen from '../../app/health';

const pending: GoLiveChecklist = {
  allPassed: false, signedOffAt: null, signedOffBy: null, liveExecutionPermitted: false,
  items: [
    { id: 'feed', title: 'Executable feed verified', category: 'MARKET_DATA',
      description: 'Review measured depth and exchange timestamps.', passed: false, verifiedAt: null },
    { id: 'limits', title: 'Risk limits reviewed', category: 'RISK_CAPS', description: 'Review personal risk limits.',
      passed: true, verifiedAt: '2026-10-10T06:00:00.000Z', evidence: 'Owner recorded the configured capital ceiling.' },
  ],
};
const confirmed: GoLiveChecklist = { ...pending, allPassed: true,
  items: pending.items.map((item) => ({ ...item, passed: true, verifiedAt: '2026-10-10T06:00:00.000Z',
    evidence: item.evidence || 'Actual feed depth and timestamps reviewed.' })) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('React', React);
  api.getGoLiveChecklist.mockResolvedValue(pending);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Explicit owner checklist evidence', () => {
  it('exposes evidence review on Health and identifies unmeasured broker telemetry', async () => {
    const timestamp = '2026-10-10T06:00:00.000Z';
    api.getDiagnostics.mockResolvedValue({ memoryUsageMb: 20, marketFeed: { latencyMs: 0, connected: false,
      staleTicksCount: 0, lastTickAt: null } });
    api.getUpstoxSession.mockResolvedValue({ isConnected: false, isExpired: false, tokenExpiresAt: null,
      secondsRemaining: 0, egressIpVerified: false, currentEgressIp: '', rateLimitRemaining: 0 });
    api.getReconciliationReport.mockResolvedValue({ timestamp, status: 'CLEAN', brokerPositionsCount: 0,
      localPositionsCount: 0, brokerOrdersCount: 0, localOrdersCount: 0, discrepancies: [] });
    api.getReconciliationSchedule.mockResolvedValue({ schedulerActive: false, intervalSeconds: 60, totalRuns: 0 });
    api.getAlerts.mockResolvedValue([]);
    render(React.createElement(HealthScreen));
    await screen.findByRole('heading', { name: 'Broker Health & Diagnostics' }, { timeout: 5000 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getAllByText('Not measured')).toHaveLength(2);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText('Expired or unavailable')).toBeTruthy();
    expect(screen.queryByText(/25 req\/sec|all operational subsystems healthy|AES-256-GCM Encrypted/)).toBeNull();
  }, 15000);
  it('requires owner-entered evidence and applies only API-confirmed verification before final sign-off', async () => {
    render(React.createElement(LiveChecklistReview));
    const input = await screen.findByRole('textbox', { name: 'Evidence for Executable feed verified' });
    const verify = screen.getByRole('button', { name: 'Verify Executable feed verified' }) as HTMLButtonElement;
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(verify.disabled).toBe(true);
    expect(api.signOffChecklistItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Owner name for checklist sign-off' }), { target: { value: 'Personal Owner' } });
    expect((screen.getByRole('button', { name: 'Record Owner Sign-Off' }) as HTMLButtonElement).disabled).toBe(true);
    const evidence = 'Observed actual bid and ask depth at 11:30 IST, reference 52175.';
    fireEvent.change(input, { target: { value: evidence } });
    api.signOffChecklistItem.mockResolvedValue(confirmed.items[0]); api.getGoLiveChecklist.mockResolvedValue(confirmed);
    fireEvent.click(verify);
    await screen.findByText('Evidence recorded for Executable feed verified.');
    expect(api.signOffChecklistItem).toHaveBeenCalledWith('feed', evidence);
    expect((screen.getByRole('button', { name: 'Record Owner Sign-Off' }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.signOffGoLiveChecklist).not.toHaveBeenCalled();
  });

  it('shows failed item verification without marking it confirmed or enabling final sign-off', async () => {
    api.signOffChecklistItem.mockRejectedValue(new Error('Evidence persistence failed'));
    render(React.createElement(LiveChecklistReview));
    const input = await screen.findByRole('textbox', { name: 'Evidence for Executable feed verified' });
    fireEvent.change(input, { target: { value: 'Owner explicitly reviewed actual broker timestamps.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Executable feed verified' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Evidence persistence failed')).toBeTruthy();
    expect(screen.getByText('PENDING VERIFICATION')).toBeTruthy();
    expect(screen.queryByText(/Evidence recorded for/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Record Owner Sign-Off' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.signOffGoLiveChecklist).not.toHaveBeenCalled();
  });

  it('does not fabricate owner sign-off after its API fails', async () => {
    api.getGoLiveChecklist.mockResolvedValue(confirmed);
    api.signOffGoLiveChecklist.mockRejectedValue(new Error('Owner sign-off rejected'));
    render(React.createElement(LiveChecklistReview));
    await screen.findByRole('textbox', { name: 'Evidence for Executable feed verified' });
    const owner = screen.getByRole('textbox', { name: 'Owner name for checklist sign-off' });
    expect((owner as HTMLInputElement).value).toBe('');
    fireEvent.change(owner, { target: { value: 'Personal Owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Owner Sign-Off' }));
    await screen.findByText('Owner sign-off rejected');
    expect(api.signOffGoLiveChecklist).toHaveBeenCalledWith('Personal Owner');
    expect(screen.queryByText(/Recorded owner sign-off:/)).toBeNull();
    expect(screen.queryByText('Owner sign-off recorded by the API.')).toBeNull();
  });
});
