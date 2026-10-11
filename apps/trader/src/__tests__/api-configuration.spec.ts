import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiBaseUrl } from '../services/api-url';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Trader API configuration', () => {
  it.each([undefined, '', '  '])('uses the local API when configuration is %s', (value) => {
    expect(resolveApiBaseUrl(value)).toBe('http://localhost:4000/api/v1');
  });

  it.each(['https://api.example.com', ' https://api.example.com/// ', 'http://localhost:3000/'])
    ('adds the API prefix to the configured origin %s', (value) => {
      expect(resolveApiBaseUrl(value)).toBe(`${value.trim().replace(/\/+$/, '')}/api/v1`);
    });

  it.each(['https://api.example.com/api/v1/', 'https://api.example.com/trading/api/v1/', '/api/v1/'])
    ('preserves the explicit path in %s', (value) => {
      expect(resolveApiBaseUrl(value)).toBe(value.replace(/\/+$/, ''));
    });

  it('sends login to the versioned endpoint on the configured API origin', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.com');
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'owner-session', expiresAt: '2027-01-01T00:00:00Z' }),
    });
    vi.stubGlobal('fetch', fetchFn);
    const { apiClient } = await import('../services/api');

    await apiClient.login('owner', 'isolated-login-password');

    expect(fetchFn).toHaveBeenCalledWith('https://api.example.com/api/v1/auth/login', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ username: 'owner', password: 'isolated-login-password' }),
    }));
  });
});
