import { BadRequestException, Controller, Get, Header, Inject, Param, Post, Query } from '@nestjs/common';
import { DataJournalService, JOURNAL_TABLES, JournalTable } from './data-journal.service';

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new BadRequestException(`Invalid time '${value}'. Use ISO-8601 or epoch milliseconds.`);
  return parsed;
}

@Controller('journal')
export class JournalController {
  constructor(@Inject(DataJournalService) private readonly journal: DataJournalService) {}

  @Get()
  public summary() { return this.journal.summary(); }

  private rows(table: string, from?: string, to?: string, limit?: string, match?: string) {
    if (!JOURNAL_TABLES.includes(table as JournalTable)) throw new BadRequestException(`Unknown journal table. Use one of: ${JOURNAL_TABLES.join(', ')}.`);
    return this.journal.query(table as JournalTable, { from: parseTime(from), to: parseTime(to), limit: limit ? Number(limit) : undefined, match });
  }

  @Get(':table.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  public csv(@Param('table') table: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('match') match?: string) {
    const rows = this.rows(table, from, to, limit, match);
    if (rows.length === 0) return '';
    const columns = Object.keys(rows[0]!);
    return [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\n') + '\n';
  }

  @Get(':table')
  public table(@Param('table') table: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('match') match?: string) {
    return this.rows(table, from, to, limit, match);
  }

  @Post('purge')
  public purge() { return { deleted: this.journal.purgeExpired(), summary: this.journal.summary() }; }
}
