import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { EnvService } from '../config/env.service.ts';
import { HealthController } from '../health/health.controller.ts';
import { RiskService } from '../risk/risk.service.ts';
import { RiskReservationManager } from '../risk/risk-reservation.manager.ts';
import { RiskState, TradeMode } from '@trading-bot/contracts';

describe('API Health and Risk Service', () => {
  it('HealthController returns live status and system mode', () => {
    const envService = new EnvService();
    const controller = new HealthController(envService);
    const live = controller.getLive();

    expect(live.status).toBe('ok');
    expect(live.mode).toBe(TradeMode.PAPER);
  });

  it('RiskService initializes DISARMED and handles emergency stop', () => {
    const envService = new EnvService();
    const gateway = { broadcast: () => {} } as any;
    const reservationManager = new RiskReservationManager(envService, gateway);
    const riskService = new RiskService(envService, reservationManager);

    const initial = riskService.getStatus();
    expect(initial.state).toBe(RiskState.DISARMED);
    expect(initial.killSwitchActive).toBe(false);

    // Emergency stop test
    const emergency = riskService.triggerEmergencyStop();
    expect(emergency.success).toBe(true);

    const postEmergency = riskService.getStatus();
    expect(postEmergency.state).toBe(RiskState.EMERGENCY_STOP);
    expect(postEmergency.killSwitchActive).toBe(true);

    // Cannot arm when emergency stop is active
    expect(() => riskService.arm(30)).toThrow();
  });
});
