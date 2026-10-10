import { describe, expect, it, vi } from 'vitest';
import { TradingPlatformClient } from '../client';

function createClient() {
  const response = { id: 'result' };
  const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
  return {
    client: new TradingPlatformClient({ baseUrl: 'http://localhost/api/v1/', authToken: 'operator-token', fetchFn: fetchFn as any }),
    fetchFn,
    response,
  };
}

describe('Daily Trading Bot SDK', () => {
  it('fetches today, setups, and a session using authenticated requests', async () => {
    const { client, fetchFn, response } = createClient();
    expect(await client.getDailyBotToday()).toEqual(response);
    await client.getDailyBotSetups();
    await client.getDailyBotSession('session/a');
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost/api/v1/daily-bot/today',
      'http://localhost/api/v1/daily-bot/setups',
      'http://localhost/api/v1/daily-bot/sessions/session%2Fa',
    ]);
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer operator-token' }),
    }));
  });

  it('posts daily setup, clone, preflight and explicit start consent', async () => {
    const { client, fetchFn } = createClient();
    const config = {
      name: 'NIFTY daily', tradingDate: '2026-10-12', strategyId: '550e8400-e29b-41d4-a716-446655440000',
      dailyCapitalBudget: 10000, dailyMaxLossAllIn: 600, perTradeMaxLossAllIn: 200, maxCapitalPerTrade: 5000,
    };
    await client.createDailyBotSetup(config);
    await client.cloneDailyBotSetup('setup/a', '2026-10-13');
    await client.preflightDailyBot('setup/a');
    await client.startDailyBot('setup/a', { operatorConsent: true, confirmationCode: 'START' });
    expect(fetchFn.mock.calls.map(([url, options]) => [url, options.method, options.body])).toEqual([
      ['http://localhost/api/v1/daily-bot/setups', 'POST', JSON.stringify(config)],
      ['http://localhost/api/v1/daily-bot/setups/setup%2Fa/clone', 'POST', JSON.stringify({ tradingDate: '2026-10-13' })],
      ['http://localhost/api/v1/daily-bot/setups/setup%2Fa/preflight', 'POST', undefined],
      ['http://localhost/api/v1/daily-bot/setups/setup%2Fa/start', 'POST', JSON.stringify({ operatorConsent: true, confirmationCode: 'START' })],
    ]);
  });

  it.each(['pause', 'resume', 'stop', 'emergency-stop', 'approve-entry'] as const)('posts the %s session control', async (action) => {
    const { client, fetchFn, response } = createClient();
    expect(await client.controlDailyBot('session/a', action)).toEqual(response);
    expect(fetchFn).toHaveBeenCalledWith(`http://localhost/api/v1/daily-bot/sessions/session%2Fa/${action}`, expect.objectContaining({ method: 'POST' }));
  });

  it('reports rejected preflight and start requests with the API response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'A daily bot is already running' });
    const client = new TradingPlatformClient({ baseUrl: 'http://localhost/api/v1', fetchFn: fetchFn as any });
    await expect(client.startDailyBot('setup', { operatorConsent: true })).rejects.toThrow('API error 409 on /daily-bot/setups/setup/start: A daily bot is already running');
  });
});
