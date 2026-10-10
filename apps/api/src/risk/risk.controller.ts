import { Body, Controller, Get, Post, Inject } from '@nestjs/common';
import { RiskService } from './risk.service';

@Controller('risk')
export class RiskController {
  constructor(@Inject(RiskService) private readonly riskService: RiskService) {}

  @Get('status')
  getStatus() {
    return this.riskService.getStatus();
  }

  @Post('arm')
  arm(@Body('durationMinutes') durationMinutes = 60) {
    return this.riskService.arm(durationMinutes);
  }

  @Post('disarm')
  disarm() {
    return this.riskService.disarm();
  }

  @Post('emergency-stop')
  emergencyStop() {
    return this.riskService.triggerEmergencyStop();
  }
}
