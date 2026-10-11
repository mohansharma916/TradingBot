import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EnvService } from '../config/env.service';

/** One process owns account dispatch for this personal installation's shared state directory. */
@Injectable()
export class RuntimeLeaseService implements OnModuleInit, OnModuleDestroy {
  private static activeInstance: RuntimeLeaseService | null = null;
  private descriptor: number | null = null;
  private filename: string;

  constructor(@Inject(EnvService) env: EnvService) {
    this.filename = path.resolve(env.config.STATE_DIRECTORY ?? '.data', 'account-runtime.lock');
    this.onModuleInit();
  }

  onModuleInit(): void {
    if (process.env.VITEST || this.descriptor !== null) return;

    if (RuntimeLeaseService.activeInstance !== null && RuntimeLeaseService.activeInstance !== this) {
      throw new Error('Account runtime is locked. Stop the other API process; after an unclean crash, verify no runtime is running before removing account-runtime.lock.');
    }

    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    try {
      this.descriptor = fs.openSync(this.filename, 'wx', 0o600);
    } catch {
      if (fs.existsSync(this.filename)) {
        try {
          const raw = fs.readFileSync(this.filename, 'utf-8');
          let isStale = false;

          if (!raw || raw.trim().length === 0) {
            isStale = true;
          } else {
            const data = JSON.parse(raw);
            const isDifferentContainer = Boolean(data?.hostname && data.hostname !== os.hostname());

            if (isDifferentContainer) {
              isStale = true;
            } else if (typeof data?.pid === 'number') {
              if (data.pid === process.pid) {
                // Same PID in a new execution context without an active instance means previous process died
                isStale = RuntimeLeaseService.activeInstance === null;
              } else {
                try {
                  process.kill(data.pid, 0);
                  isStale = false;
                } catch (err: any) {
                  isStale = err.code === 'ESRCH';
                }
              }
            } else {
              isStale = true;
            }
          }

          if (isStale && RuntimeLeaseService.activeInstance === null) {
            fs.unlinkSync(this.filename);
            this.descriptor = fs.openSync(this.filename, 'wx', 0o600);
          }
        } catch {
          // Fall through to locked error
        }
      }

      if (this.descriptor === null) {
        throw new Error('Account runtime is locked. Stop the other API process; after an unclean crash, verify no runtime is running before removing account-runtime.lock.');
      }
    }

    fs.writeFileSync(this.descriptor, JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
    }));
    fs.fsyncSync(this.descriptor);
    RuntimeLeaseService.activeInstance = this;
  }

  onModuleDestroy(): void {
    if (this.descriptor !== null) {
      fs.closeSync(this.descriptor);
      this.descriptor = null;
      try { fs.unlinkSync(this.filename); } catch { /* ignore */ }
    }
    if (RuntimeLeaseService.activeInstance === this) {
      RuntimeLeaseService.activeInstance = null;
    }
  }

  isOwner(): boolean {
    return this.descriptor !== null;
  }
}
