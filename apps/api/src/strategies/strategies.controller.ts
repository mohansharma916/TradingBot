import { Controller, Get, Post, Put, Param, Body, Inject } from '@nestjs/common';
import { StrategiesService } from './strategies.service';

@Controller('strategies')
export class StrategiesController {
  constructor(@Inject(StrategiesService) private readonly strategiesService: StrategiesService) {}

  @Get()
  getStrategies() {
    return this.strategiesService.getAllStrategies();
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

  @Post(':id/scan')
  runAgentScan(@Param('id') id: string) {
    return this.strategiesService.runAgentScan(id);
  }
}
