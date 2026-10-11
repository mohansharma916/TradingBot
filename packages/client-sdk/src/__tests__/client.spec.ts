import { describe, it, expect, vi } from 'vitest';
import { TradingPlatformClient, formatErrorMessage } from '../client.ts';
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

  it('unpacks NestJS JSON error responses into human-readable messages instead of raw JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        message: 'Invalid confirmation code. Operator must specify CONFIRM_AUTO_EXECUTION.',
        error: 'Bad Request',
        statusCode: 400,
      }),
    });

    const client = new TradingPlatformClient({ baseUrl: 'http://localhost/api/v1', fetchFn: mockFetch as any });
    await expect(client.getLiveHealth()).rejects.toThrow('Invalid confirmation code. Operator must specify CONFIRM_AUTO_EXECUTION.');
  });

  it('joins array-based validation error messages cleanly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        message: ['maxCapitalInr must be greater than 0', 'underlying is required'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    });

    const client = new TradingPlatformClient({ baseUrl: 'http://localhost/api/v1', fetchFn: mockFetch as any });
    await expect(client.getLiveHealth()).rejects.toThrow('maxCapitalInr must be greater than 0; underlying is required');
  });
});

describe('formatErrorMessage', () => {
  it('formats errors from plain errors, embedded JSON, validation arrays, and objects', () => {
    expect(formatErrorMessage(new Error('Simple error'))).toBe('Simple error');
    expect(formatErrorMessage(new Error('API error 400 on /strategies: Strategy name is required'))).toBe('Strategy name is required');
    expect(formatErrorMessage('{"message":"A daily bot is already running","statusCode":409}')).toBe('A daily bot is already running');
    expect(formatErrorMessage('{"message":["first error","second error"],"statusCode":400}')).toBe('first error; second error');
    expect(formatErrorMessage({ message: 'Owner login required' })).toBe('Owner login required');
    expect(formatErrorMessage({ message: ['val1', 'val2'] })).toBe('val1; val2');
    expect(formatErrorMessage({ error: 'Unauthorized access' })).toBe('Unauthorized access');
    expect(formatErrorMessage({ details: 'Lock already acquired' })).toBe('Lock already acquired');
    expect(formatErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(formatErrorMessage(undefined)).toBe('An unexpected error occurred.');
  });
});

