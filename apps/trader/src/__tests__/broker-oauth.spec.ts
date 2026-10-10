import { describe, it, expect } from 'vitest';
import {
  UpstoxSessionStatusSchema,
  ReconciliationReportSchema,
  ReconciliationDiscrepancySchema,
  BrokerHealthSchema,
  BrokerHealthStatus,
} from '@trading-bot/contracts';

describe('Trader Client: Upstox OAuth & Broker Health Contracts', () => {
  it('validates UpstoxSessionStatusSchema displayed on Health Screen', () => {
    const session = {
      isConnected: true,
      isExpired: false,
      tokenExpiresAt: new Date(Date.now() + 85400000).toISOString(),
      secondsRemaining: 85400,
      egressIpVerified: true,
      registeredEgressIp: '127.0.0.1',
      currentEgressIp: '127.0.0.1',
      rateLimitRemaining: 25,
      lastReconciledAt: new Date().toISOString(),
    };

    const parsed = UpstoxSessionStatusSchema.parse(session);
    expect(parsed.isConnected).toBe(true);
    expect(parsed.rateLimitRemaining).toBe(25);
    expect(parsed.egressIpVerified).toBe(true);
  });

  it('validates ReconciliationReportSchema and flags frozen status on mismatch', () => {
    const mismatch = {
      type: 'PHANTOM_BROKER_POSITION' as const,
      instrumentKey: 'NSE_FO|BANKNIFTY_2026-10-15_52500_PE',
      brokerValue: { symbol: 'BANKNIFTY 52500 PE', netQuantity: 15 },
      localValue: null,
      severity: 'CRITICAL' as const,
      actionTaken: 'Flagged phantom exposure outside bot. Trading engine FROZEN via Kill Switch.',
    };

    const parsedMismatch = ReconciliationDiscrepancySchema.parse(mismatch);
    expect(parsedMismatch.severity).toBe('CRITICAL');

    const report = {
      timestamp: new Date().toISOString(),
      status: 'MISMATCH_DETECTED' as const,
      brokerPositionsCount: 2,
      localPositionsCount: 1,
      brokerOrdersCount: 2,
      localOrdersCount: 2,
      discrepancies: [parsedMismatch],
      executionFrozen: true,
    };

    const parsedReport = ReconciliationReportSchema.parse(report);
    expect(parsedReport.status).toBe('MISMATCH_DETECTED');
    expect(parsedReport.executionFrozen).toBe(true);
    expect(parsedReport.discrepancies.length).toBe(1);
  });

  it('validates BrokerHealthSchema with static egress IP match', () => {
    const health = {
      broker: 'UPSTOX' as const,
      status: BrokerHealthStatus.HEALTHY,
      isAuthenticated: true,
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      registeredEgressIp: '127.0.0.1',
      currentEgressIp: '127.0.0.1',
      ipMatches: true,
      marketFeedConnected: true,
      feedLatencyMs: 16,
      lastSeenAt: new Date().toISOString(),
    };

    const parsed = BrokerHealthSchema.parse(health);
    expect(parsed.status).toBe(BrokerHealthStatus.HEALTHY);
    expect(parsed.ipMatches).toBe(true);
    expect(parsed.feedLatencyMs).toBe(16);
  });
});
