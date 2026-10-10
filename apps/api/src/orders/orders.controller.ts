import { Controller, Get, Post, Param, Body, Inject } from '@nestjs/common';
import {
  BrokerOrder,
  Position,
  OrderFillEvent,
  SupervisedExecutionRequest,
  SupervisedExecutionResult,
  GoLiveChecklist,
} from '@trading-bot/contracts';
import { OrdersService } from './orders.service';
import { SupervisedExecutionService } from './supervised-execution.service';
import { GoLiveChecklistService } from './go-live-checklist.service';

@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(SupervisedExecutionService) private readonly supervisedExecution: SupervisedExecutionService,
    @Inject(GoLiveChecklistService) private readonly goLiveChecklist: GoLiveChecklistService,
  ) {}

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

  // --- Phase 5: Supervised Execution & GTT Protection Endpoints ---

  @Post('orders/supervised-execute')
  async executeSupervised(
    @Body() body: SupervisedExecutionRequest,
  ): Promise<SupervisedExecutionResult> {
    return this.supervisedExecution.executeSupervisedProposal(body);
  }

  @Get('orders/go-live-checklist')
  getGoLiveChecklist(): GoLiveChecklist {
    return this.goLiveChecklist.getChecklist();
  }

  @Post('orders/go-live-checklist/sign-off')
  signOffChecklist(@Body('signedOffBy') signedOffBy = 'Platform Owner'): GoLiveChecklist {
    return this.goLiveChecklist.completeChecklist(signedOffBy);
  }

  @Post('orders/go-live-checklist/sign-off-item')
  signOffChecklistItem(
    @Body('id') id: string,
    @Body('evidence') evidence?: string,
  ) {
    return this.goLiveChecklist.signOffItem(id, evidence);
  }
}
