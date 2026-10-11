import { Controller, Get, Post, Put, Param, Body, Inject } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { PriceActionMomentumService } from './price-action-momentum.service';

@Controller('strategies')
export class StrategiesController {
  constructor(
    @Inject(StrategiesService) private readonly strategiesService: StrategiesService,
    @Inject(PriceActionMomentumService) private readonly pamService: PriceActionMomentumService,
  ) {}

  @Get()
  getStrategies() {
    return this.strategiesService.getAllStrategies();
  }

  @Get('templates')
  getTemplates() {
    return this.strategiesService.getTemplates();
  }

  @Post('validate')
  validateRules(@Body() body: any) {
    return this.strategiesService.validateStrategyAst(body);
  }

  @Post('from-template/:templateId')
  createFromTemplate(@Param('templateId') templateId: string, @Body() body: any) {
    return this.strategiesService.createFromTemplate(templateId, body);
  }

  @Get(':id')
  getStrategy(@Param('id') id: string) {
    return this.strategiesService.getStrategy(id);
  }

  @Get(':id/versions')
  getVersionHistory(@Param('id') id: string) {
    return this.strategiesService.getVersionHistory(id);
  }

  @Post()
  createStrategy(@Body() dto: any) {
    return this.strategiesService.createStrategy(dto);
  }

  @Put(':id')
  updateStrategy(@Param('id') id: string, @Body() dto: any) {
    return this.strategiesService.updateStrategy(id, dto);
  }

  @Post(':id/duplicate')
  duplicateStrategy(@Param('id') id: string) {
    return this.strategiesService.duplicateStrategy(id);
  }

  @Post(':id/archive')
  archiveStrategy(@Param('id') id: string) {
    return this.strategiesService.archiveStrategy(id);
  }

  @Post('price-action-momentum/evaluate')
  evaluatePriceActionMomentum(@Body() body: any) {
    return this.pamService.evaluateSignal(
      body.candles ?? [],
      body.currentPrice ?? 0,
      body.config,
      body.fiveMinuteCandles,
    );
  }

  @Post('price-action-momentum/backtest')
  backtestPriceActionMomentum(@Body() body: any) {
    return this.pamService.runBacktest(body);
  }

  @Post('price-action-momentum/optimize')
  optimizePriceActionMomentum(@Body() body: any) {
    return this.pamService.runParameterOptimization(body.candles ?? [], body.config);
  }

  @Post(':id/scan')
  runAgentScan(@Param('id') id: string) {
    return this.strategiesService.runAgentScan(id);
  }

  @Post(':id/backtest')
  runBacktest(@Param('id') id: string, @Body() body: any) {
    return this.strategiesService.runBacktest(id, body);
  }
}

