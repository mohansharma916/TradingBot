import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AlertSeverity, SystemAlert } from '@trading-bot/contracts';

@Controller('alerts')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get()
  getAlerts(@Query('limit') limit?: number): SystemAlert[] {
    return this.notificationsService.getAlerts(limit ? Number(limit) : 50);
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledgeAlert(@Param('id') id: string): SystemAlert {
    return this.notificationsService.acknowledgeAlert(id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  triggerTestDrillAlert(
    @Body('severity') severity: AlertSeverity = AlertSeverity.WARNING,
    @Body('category') category: any = 'SYSTEM',
    @Body('title') title = 'Incident Recovery Drill Alert',
    @Body('message') message = 'Simulated operational drill: verifying multi-channel alert delivery.',
  ): SystemAlert {
    return this.notificationsService.dispatchAlert({
      severity,
      category,
      title,
      message,
    });
  }
}
