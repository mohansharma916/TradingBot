import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { DailyBotService } from './daily-bot.service';

@Controller('daily-bot')
export class DailyBotController {
  constructor(@Inject(DailyBotService) private readonly dailyBot: DailyBotService) {}

  @Get('today')
  public today() { return this.dailyBot.getToday(); }

  @Get('setups')
  public setups() { return this.dailyBot.getSetups(); }

  @Post('setups')
  public create(@Body() input: unknown) { return this.dailyBot.createSetup(input); }

  @Post('setups/:id/clone')
  public clone(@Param('id') id: string, @Body() input: unknown) { return this.dailyBot.cloneSetup(id, input); }

  @Post('setups/:id/preflight')
  public preflight(@Param('id') id: string) { return this.dailyBot.preflight(id); }

  @Post('setups/:id/start')
  public start(@Param('id') id: string, @Body() input: unknown) { return this.dailyBot.start(id, input); }

  @Get('sessions/:id')
  public session(@Param('id') id: string) { return this.dailyBot.getSession(id); }

  @Post('sessions/:id/pause')
  public pause(@Param('id') id: string) { return this.dailyBot.pause(id); }

  @Post('sessions/:id/resume')
  public resume(@Param('id') id: string) { return this.dailyBot.resume(id); }

  @Post('sessions/:id/stop')
  public stop(@Param('id') id: string) { return this.dailyBot.stop(id); }

  @Post('sessions/:id/emergency-stop')
  public emergencyStop(@Param('id') id: string) { return this.dailyBot.stop(id, true); }

  @Post('sessions/:id/approve-entry')
  public approveEntry(@Param('id') id: string) { return this.dailyBot.approveEntry(id); }
}
