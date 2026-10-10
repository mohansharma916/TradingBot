import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  AutonomousReadinessReport,
  AutonomousArmRequest,
  AutonomousArmRequestSchema,
  AutonomousSessionStatus,
  AutonomousExecutionLog,
  SupervisedExecutionResult,
} from '@trading-bot/contracts';
import { AutonomousExecutionService } from './autonomous-execution.service';

@Controller('autonomous')
export class AutonomousController {
  constructor(
    @Inject(AutonomousExecutionService)
    private readonly autonomousService: AutonomousExecutionService,
  ) {}

  @Get('readiness')
  async getReadiness(): Promise<AutonomousReadinessReport> {
    return this.autonomousService.checkReadiness();
  }

  @Get('status')
  getStatus(): AutonomousSessionStatus {
    return this.autonomousService.getSessionStatus();
  }

  @Post('arm')
  @HttpCode(HttpStatus.OK)
  async armSession(@Body() body: AutonomousArmRequest): Promise<AutonomousSessionStatus> {
    const validated = AutonomousArmRequestSchema.parse(body);
    return this.autonomousService.armAutonomous(validated);
  }

  @Post('disarm')
  @HttpCode(HttpStatus.OK)
  disarmSession(@Body('reason') reason?: string): AutonomousSessionStatus {
    return this.autonomousService.disarmAutonomous(reason || 'Operator Manual Disarm');
  }

  @Post('execute/:proposalId')
  @HttpCode(HttpStatus.OK)
  async executeProposal(
    @Param('proposalId') proposalId: string,
  ): Promise<SupervisedExecutionResult> {
    return this.autonomousService.executeAutonomousProposal(proposalId);
  }

  @Get('logs')
  getLogs(): AutonomousExecutionLog[] {
    return this.autonomousService.getExecutionLogs();
  }
}
