import { Controller, Get, Post, Param, Body, Inject } from '@nestjs/common';
import { BrokerOrder, Position } from '@trading-bot/contracts';
import { OrdersService } from './orders.service';
import { OrderFillEvent } from '../broker/paper-broker.adapter';

@Controller()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Get('orders')
  async getOrders(): Promise<BrokerOrder[]> {
    return this.ordersService.getOrders();
  }

  @Get('positions')
  async getPositions(): Promise<Position[]> {
    return this.ordersService.getPositions();
  }

  @Get('orders/fills')
  getFills(): OrderFillEvent[] {
    return this.ordersService.getFills();
  }

  @Post('orders/execute-proposal')
  async executeProposal(
    @Body('proposalId') proposalId: string,
    @Body('simulatedPartialFill') simulatedPartialFill?: boolean,
  ) {
    return this.ordersService.executeApprovedProposal(proposalId, { simulatedPartialFill });
  }

  @Post('positions/:key/close')
  async closePosition(@Param('key') key: string) {
    return this.ordersService.closePosition(key);
  }
}
