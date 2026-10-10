import { Controller, Get } from '@nestjs/common';
import { BrokerOrder, OrderSide, OrderStatus, OrderType, Position, ProductType } from '@trading-bot/contracts';

@Controller()
export class OrdersController {
  @Get('orders')
  getOrders(): BrokerOrder[] {
    return [
      {
        id: 'ord_sample_001',
        intentId: 'int_sample_001',
        brokerOrderId: '2410100001234',
        tag: 'STRAT_EMA_01',
        instrumentKey: 'NSE_FO|52175',
        side: OrderSide.BUY,
        orderType: OrderType.LIMIT,
        product: ProductType.I,
        quantity: 25,
        price: 122.5,
        status: OrderStatus.FILLED,
        filledQuantity: 25,
        averageFillPrice: 122.5,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 3590000).toISOString(),
      },
    ];
  }

  @Get('positions')
  getPositions(): Position[] {
    return [
      {
        id: 'pos_sample_001',
        instrumentKey: 'NSE_FO|52175',
        symbol: 'NIFTY26OCT25100CE',
        netQuantity: 25,
        buyQuantity: 25,
        sellQuantity: 0,
        buyAvgPrice: 122.5,
        sellAvgPrice: 0,
        lastPrice: 124.5,
        unrealizedPnl: 50.0, // (124.5 - 122.5) * 25
        realizedPnl: 0,
        stopLossPrice: 114.0,
        targetPrice: 136.0,
        lastVerifiedAt: new Date().toISOString(),
      },
    ];
  }
}
