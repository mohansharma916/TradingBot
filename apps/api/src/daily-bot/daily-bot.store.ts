import { Injectable, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DailyBotSession, DailyBotSessionSchema, DailyBotSetup, DailyBotSetupSchema } from '@trading-bot/contracts';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const DailyBotStateSchema = z.object({
  version: z.literal(1),
  setups: z.array(DailyBotSetupSchema),
  sessions: z.array(DailyBotSessionSchema),
}).superRefine((state, context) => {
  const setupIds = new Set(state.setups.map((setup) => setup.id));
  if (setupIds.size !== state.setups.length || new Set(state.sessions.map((session) => session.id)).size !== state.sessions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate setup or session identifiers' });
  }
  for (const session of state.sessions) {
    const setup = state.setups.find((candidate) => candidate.id === session.setupId);
    if (!setup || JSON.stringify(session.config) !== JSON.stringify(setup.config) || JSON.stringify(session.strategySnapshot) !== JSON.stringify(setup.strategySnapshot)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Session configuration must match its immutable setup' });
    }
  }
});

export interface DailyBotState {
  version: 1;
  setups: DailyBotSetup[];
  sessions: DailyBotSession[];
}

/** Single-process durable store. Commit before publishing state to callers. */
@Injectable()
export class DailyBotStore {
  public readonly storagePath: string;
  private state: DailyBotState;
  private writeFailure: string | null = null;

  constructor(@Optional() @Inject('DAILY_BOT_STORAGE_PATH') storagePath?: string) {
    this.storagePath = path.resolve(storagePath || process.env.DAILY_BOT_STORAGE_PATH || path.resolve(__dirname, '../../../../.data/daily-bot.json'));
    this.state = this.load();
  }

  private load(): DailyBotState {
    try {
      return DailyBotStateSchema.parse(JSON.parse(fs.readFileSync(this.storagePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, setups: [], sessions: [] };
      throw new ServiceUnavailableException('Daily Bot storage could not be read or validated. Restore the saved file before starting sessions.');
    }
  }

  public snapshot(): DailyBotState {
    return structuredClone(this.state);
  }

  public assertWritable(): void {
    if (this.writeFailure) {
      throw new ServiceUnavailableException(`Daily Bot persistence is unavailable; new entries are disabled. ${this.writeFailure}`);
    }
  }

  public commit(next: DailyBotState): void {
    this.assertWritable();
    const parsed = DailyBotStateSchema.parse(next);
    // Setups are append-only, including their captured strategy version.
    for (const original of this.state.setups) {
      const candidate = parsed.setups.find((setup) => setup.id === original.id);
      if (!candidate || JSON.stringify(candidate) !== JSON.stringify(original)) {
        throw new Error('Saved Daily Bot setups are immutable. Clone a setup to change its configuration.');
      }
    }

    const directory = path.dirname(this.storagePath);
    const temporaryPath = path.join(directory, `.daily-bot-${randomUUID()}.tmp`);
    let temporaryFd: number | undefined;
    let directoryFd: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      temporaryFd = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(temporaryFd, `${JSON.stringify(parsed)}\n`, 'utf8');
      fs.fsyncSync(temporaryFd);
      fs.closeSync(temporaryFd);
      temporaryFd = undefined;
      fs.renameSync(temporaryPath, this.storagePath);
      directoryFd = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryFd);
      fs.closeSync(directoryFd);
      directoryFd = undefined;
      this.state = structuredClone(parsed);
    } catch (error) {
      this.writeFailure = `Storage write failed (${(error as NodeJS.ErrnoException).code || 'IO_ERROR'}). Repair storage and restart the API.`;
      throw new ServiceUnavailableException(`Daily Bot state was not durably confirmed. ${this.writeFailure}`);
    } finally {
      try { if (temporaryFd !== undefined) fs.closeSync(temporaryFd); } catch { /* Preserve the storage error. */ }
      try { if (directoryFd !== undefined) fs.closeSync(directoryFd); } catch { /* Preserve the storage error. */ }
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* Preserve the storage error. */ }
    }
  }
}
