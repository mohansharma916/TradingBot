import { Injectable, Inject } from '@nestjs/common';
import { BrokerPort, FundsSnapshot, MarginEstimate, OrderAcknowledgement } from './broker.port';
import { BrokerHealth, BrokerHealthStatus, BrokerOrder, Instrument, Position, OrderStatus, OrderSide, OrderType, ProductType } from '@trading-bot/contracts';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';

@Injectable()
export class PaperBrokerAdapter implements BrokerPort {
  public readonly brokerName = 'PAPER_SIMULATION';

  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
  ) {}

  async getConnectionHealth(): Promise<BrokerHealth> {
    return {
      broker: 'UPSTOX',
      status: BrokerHealthStatus.HEALTHY,
      isAuthenticated: true,
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      registeredEgressIp: '127.0.0.1',
      currentEgressIp: '127.0.0.1',
      ipMatches: true,
      marketFeedConnected: true,
      feedLatencyMs: 12,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getFunds(): Promise<FundsSnapshot> {
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
    return [
      {
        id: 'ord_paper_001',
        intentId: 'int_paper_001',
        brokerOrderId: 'PAPER_241010001',
        tag: 'PAPER_SIM',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        side: OrderSide.BUY,
        orderType: OrderType.LIMIT,
        product: ProductType.I,
        quantity: 25,
        price: 122.5,
        status: OrderStatus.FILLED,
        filledQuantity: 25,
        averageFillPrice: 122.5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  async getPositions(): Promise<Position[]> {
    return [
      {
        id: 'pos_paper_001',
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
        symbol: 'NIFTY 25100 CE 2026-10-15',
        netQuantity: 25,
        buyQuantity: 25,
        sellQuantity: 0,
        buyAvgPrice: 122.5,
        sellAvgPrice: 0,
        lastPrice: 124.5,
        unrealizedPnl: 50.0,
        realizedPnl: 0,
        stopLossPrice: 114.0,
        targetPrice: 136.0,
        lastVerifiedAt: new Date().toISOString(),
      },
    ];
  }

  async placeOrder(req: any): Promise<OrderAcknowledgement> {
    return {
      orderId: `PAPER_${Date.now()}`,
      tag: req.tag || 'PAPER_DEFAULT',
      status: 'ACKNOWLEDGED',
      message: 'Paper simulation order received and acknowledged.',
    };
  }

  async modifyOrder(req: any): Promise<OrderAcknowledgement> {
    return {
      orderId: req.orderId,
      tag: req.tag || 'PAPER_MOD',
      status: 'MODIFIED',
      message: 'Paper simulation order modified.',
    };
  }

  async cancelOrder(_orderId: string): Promise<void> {
    // Simulated cancel
  }
}
