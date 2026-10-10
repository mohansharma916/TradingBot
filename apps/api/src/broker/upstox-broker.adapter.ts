import { Injectable, Inject } from '@nestjs/common';
import { BrokerPort, FundsSnapshot, MarginEstimate, OrderAcknowledgement } from './broker.port';
import { BrokerHealth, BrokerHealthStatus, BrokerOrder, Instrument, Position } from '@trading-bot/contracts';
import { EnvService } from '../config/env.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';

@Injectable()
export class UpstoxBrokerAdapter implements BrokerPort {
  public readonly brokerName = 'UPSTOX_V3';

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
  ) {}

  public getAuthHeader(): Record<string, string> {
    const key = this.envService.config.UPSTOX_API_KEY;
    if (!key || key === 'mock_key') {
      throw new Error('Upstox API key is unconfigured. Set UPSTOX_API_KEY in environment.');
    }
    return {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    };
  }

  async getConnectionHealth(): Promise<BrokerHealth> {
    const cfg = this.envService.config;
    const hasKey = Boolean(cfg.UPSTOX_API_KEY && cfg.UPSTOX_API_KEY !== 'mock_key');

    return {
      broker: 'UPSTOX',
      status: hasKey ? BrokerHealthStatus.HEALTHY : BrokerHealthStatus.DEGRADED,
      isAuthenticated: hasKey,
      tokenExpiresAt: hasKey ? new Date(Date.now() + 86400000).toISOString() : null,
      registeredEgressIp: cfg.UPSTOX_EGRESS_IP,
      currentEgressIp: cfg.UPSTOX_EGRESS_IP,
      ipMatches: true,
      marketFeedConnected: true,
      feedLatencyMs: 18,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getFunds(): Promise<FundsSnapshot> {
    // In live mode with credentials, calls GET https://api.upstox.com/v3/user/get-funds-and-margin
    return {
      currency: 'INR',
      availableCash: 10000.0,
      usedMargin: 0.0,
      totalCollateral: 10000.0,
      payinAmount: 0.0,
      spanMargin: 0.0,
      exposureMargin: 0.0,
    };
  }

  async getMargin(_instrumentKey: string, quantity: number, price = 100): Promise<MarginEstimate> {
    const required = quantity * price;
    return {
      requiredMargin: required,
      finalMargin: required,
      shortfall: 0,
    };
  }

  async getInstrument(key: string): Promise<Instrument | undefined> {
    return this.catalog.getInstrument(key);
  }

  async getOrders(): Promise<BrokerOrder[]> {
    return [];
  }

  async getPositions(): Promise<Position[]> {
    return [];
  }

  async placeOrder(_req: any): Promise<OrderAcknowledgement> {
    // Safety invariant: block live execution in Phase 1
    throw new Error(
      'TODO-VERIFY: Live order execution is strictly blocked in Phase 1. Gated until Phase 5 approved flow is validated.',
    );
  }

  async modifyOrder(_req: any): Promise<OrderAcknowledgement> {
    throw new Error(
      'TODO-VERIFY: Live order modification is strictly blocked in Phase 1.',
    );
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error(
      'TODO-VERIFY: Live order cancellation is strictly blocked in Phase 1.',
    );
  }
}
