import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { EnvService } from '../config/env.service';

/** One process owns account dispatch for this personal installation's shared state directory. */
@Injectable()
export class RuntimeLeaseService implements OnModuleInit, OnModuleDestroy {
  private descriptor: number | null = null;
  private filename: string;
  constructor(@Inject(EnvService) env: EnvService) { this.filename = path.resolve(env.config.STATE_DIRECTORY ?? '.data', 'account-runtime.lock'); this.onModuleInit(); }
  onModuleInit(): void {
    if (process.env.VITEST || this.descriptor !== null) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    try { this.descriptor = fs.openSync(this.filename, 'wx', 0o600); }
    catch { throw new Error('Account runtime is locked. Stop the other API process; after an unclean crash, verify no runtime is running before removing account-runtime.lock.'); }
    fs.writeFileSync(this.descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.fsyncSync(this.descriptor);
  }
  onModuleDestroy(): void {
    if (this.descriptor !== null) { fs.closeSync(this.descriptor); this.descriptor = null; fs.unlinkSync(this.filename); }
  }
  isOwner(): boolean { return this.descriptor !== null; }
}
