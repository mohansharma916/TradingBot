import { describe, it, expect, vi } from 'vitest';
import { TradingPlatformClient } from '../client.ts';
import { TradeMode } from '@trading-bot/contracts';

describe('TradingPlatformClient', () => {
  it('uses the owner session for mode selection and clears it even when logout fails', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'owner-session', expiresAt: '2026-10-12T12:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mode: TradeMode.APPROVAL }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'offline' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });
    const client = new TradingPlatformClient({ baseUrl: 'http://localhost/api/v1', fetchFn: mockFetch as any });
    await client.login('owner', 'owner-password');
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://localhost/api/v1/auth/login', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ username: 'owner', password: 'owner-password' }),
    }));
    await client.selectTradingMode(TradeMode.APPROVAL);
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost/api/v1/trading/mode', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ mode: TradeMode.APPROVAL }), headers: expect.objectContaining({ Authorization: 'Bearer owner-session' }),
    }));
    await expect(client.logout()).rejects.toThrow('503');
    await client.getLiveHealth();
    expect(mockFetch.mock.calls[3]?.[1]?.headers.Authorization).toBeUndefined();
  });
  it('makes request with correct Authorization and JSON headers', async () => {
    const mockResponse = { status: 'ok', uptime: 1234 };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const client = new TradingPlatformClient({
      baseUrl: 'http://localhost:4000/api/v1',
      authToken: 'test-token',
      fetchFn: mockFetch as any,
    });

    const health = await client.getLiveHealth();
    expect(health).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/health/live',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});
