import { describe, it, expect, vi } from 'vitest';
import { TradingPlatformClient } from '../client.ts';

describe('TradingPlatformClient', () => {
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
