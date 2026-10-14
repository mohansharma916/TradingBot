import { ConsoleLogger } from '@nestjs/common';
import { DataJournalService } from './data-journal.service';

/** Console output unchanged; each line is also kept in the rolling journal. */
export class JournalLogger extends ConsoleLogger {
  constructor(private readonly journal: DataJournalService) { super(); }

  private capture(level: string, message: unknown, params: unknown[]): void {
    const last = params[params.length - 1];
    const context = typeof last === 'string' ? last : this.context ?? '';
    const text = typeof message === 'string' ? message : message instanceof Error ? message.stack ?? message.message : JSON.stringify(message);
    const stack = level === 'error' && params.length > 1 && typeof params[0] === 'string' ? `\n${params[0]}` : '';
    this.journal.recordLog(level, context, text + stack);
  }

  override log(message: unknown, ...params: unknown[]) { super.log(message, ...params); this.capture('log', message, params); }
  override warn(message: unknown, ...params: unknown[]) { super.warn(message, ...params); this.capture('warn', message, params); }
  override error(message: unknown, ...params: unknown[]) { super.error(message, ...params); this.capture('error', message, params); }
  override debug(message: unknown, ...params: unknown[]) { super.debug(message, ...params); this.capture('debug', message, params); }
  override verbose(message: unknown, ...params: unknown[]) { super.verbose(message, ...params); this.capture('verbose', message, params); }
  override fatal(message: unknown, ...params: unknown[]) { super.fatal(message, ...params); this.capture('fatal', message, params); }
}
