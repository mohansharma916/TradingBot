import { Controller, Get, Inject, Res } from '@nestjs/common';
import { DailyReport } from '@trading-bot/contracts';
import { ReportsService } from './reports.service';
import type { Response } from 'express';

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reportsService: ReportsService) {}

  @Get('daily')
  async getDailyReport(): Promise<DailyReport> {
    return this.reportsService.getDailyReport();
  }

  @Get('daily/export-csv')
  exportDailyCsv(@Res() res: Response) {
    const { csvContent, filename } = this.reportsService.generateCsvExport();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  }
}
