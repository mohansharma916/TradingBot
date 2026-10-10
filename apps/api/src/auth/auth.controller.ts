import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { OwnerAuthService } from './owner-auth.service';
import { TradingModeService } from '../trading/trading-mode.service';

@Controller()
export class AuthController {
  constructor(@Inject(OwnerAuthService) private readonly auth: OwnerAuthService,
    @Inject(TradingModeService) private readonly mode: TradingModeService) {}

  @Post('auth/login')
  login(@Body() body: { username: string; password: string }, @Req() request: { ip?: string }) {
    return this.auth.login(body?.username, body?.password, request.ip);
  }

  @Post('auth/logout')
  logout(@Req() request: { headers: { authorization?: string } }) {
    this.auth.logout(request.headers.authorization?.slice(7) ?? '');
    return { success: true };
  }

  @Get('me')
  getMe() {
    return {
      id: 'usr_owner_personal_001',
      loginSubject: 'owner@trading-bot.local',
      role: 'WORKSTATION_OWNER',
      mfaEnabled: false,
      systemMode: this.mode.getMode(),
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
