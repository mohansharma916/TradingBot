import { Controller, Get, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';

@Controller()
export class AuthController {
  constructor(@Inject(EnvService) private readonly envService: EnvService) {}

  @Get('me')
  getMe() {
    return {
      id: 'usr_owner_personal_001',
      loginSubject: 'owner@trading-bot.local',
      role: 'WORKSTATION_OWNER',
      mfaEnabled: this.envService.config.MFA_ENABLED,
      systemMode: this.envService.config.SYSTEM_MODE,
      permissions: [
        'STRATEGY_CREATE',
        'PROPOSAL_REVIEW',
        'PROPOSAL_APPROVE',
        'RISK_ARM',
        'EMERGENCY_STOP',
      ],
    };
  }
}
