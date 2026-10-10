import { Injectable, Inject, Optional, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { GoLiveChecklist, GoLiveChecklistItem } from '@trading-bot/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

@Injectable()
export class GoLiveChecklistService {
  private items: GoLiveChecklistItem[];
  private signedOffBy: string | null = null;
  private signedOffAt: string | null = null;
  private readonly storagePath: string | null;
  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(TokenStorageService) private readonly tokenStorage: TokenStorageService,
    @Optional() @Inject('GO_LIVE_STORAGE_PATH') storagePath?: string,
  ) {
    this.storagePath = storagePath ? path.resolve(storagePath) : process.env.VITEST ? null : path.resolve(this.envService.config.STATE_DIRECTORY || '.data', 'go-live-checklist.json');
    const definitions: Array<[string, GoLiveChecklistItem['category'], string, string]> = [
      ['chk_01_reg', 'REGULATORY', 'Broker and exchange requirements reviewed', 'Owner records applicable broker permissions and current exchange requirements; software does not certify regulatory compliance.'],
      ['chk_02_ip', 'INFRASTRUCTURE', 'Registered static IP verified', 'Owner records actual registered egress verification from the broker and deployment. Configuration alone is not a measurement.'],
      ['chk_03_caps', 'RISK_CAPS', 'Personal account risk limits reviewed', 'Owner confirms configured capital, trade loss, daily loss and position limits.'],
      ['chk_04_auth', 'BROKER_OAUTH', 'Genuine OAuth token locally valid', 'A genuine unexpired token is present. Each live entry additionally verifies broker funds.'],
      ['chk_05_feed', 'MARKET_DATA', 'Genuine executable feed verified', 'Record tested live quote provenance, exchange timestamps and bid/ask depth; entries repeat these checks.'],
      ['chk_06_reconcile', 'INFRASTRUCTURE', 'Broker reconciliation verified', 'Record a successful full broker order/position reconciliation and recovery drill.'],
      ['chk_07_gtt', 'PROTECTION_MECHANISM', 'Broker stop protection verified', 'Record a broker test of stop placement, lookup and cancellation. Trigger execution is not guaranteed.'],
      ['chk_08_kill', 'PROTECTION_MECHANISM', 'Kill switch and emergency exit verified', 'Record drills confirming entry freeze and confirmed exit fills; an accepted exit is not a closed position.'],
      ['chk_09_supervision', 'CONSENT', 'Owner supervision and recovery reviewed', 'Confirm authenticated supervision, bounded arming and handling of pending/partial/unknown order states.'],
      ['chk_10_consent', 'CONSENT', 'Owner risk consent', 'Owner accepts options risk, estimated charges, gap/slippage risk and lack of guaranteed exit fills.'],
    ];
    this.items = definitions.map(([id, category, title, description]) => ({ id, category, title, description, passed: false, verifiedAt: null }));
    if (this.storagePath) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.storagePath, 'utf8')) as GoLiveChecklist;
        if (!Array.isArray(saved.items) || saved.items.length !== this.items.length || saved.items.some((item) => !this.items.some((known) => known.id === item.id) || typeof item.passed !== 'boolean' || (item.passed && (!item.evidence || !item.verifiedAt)))) throw new Error('Invalid checklist evidence.');
        this.items = this.items.map((item) => ({ ...item, ...saved.items.find((savedItem) => savedItem.id === item.id) }));
        this.signedOffBy = saved.signedOffBy; this.signedOffAt = saved.signedOffAt;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ServiceUnavailableException('Go-live evidence cannot be validated; live execution is blocked.'); }
    }
  }
  public getChecklist(): GoLiveChecklist {
    const auth = this.items.find((item) => item.id === 'chk_04_auth')!;
    const token = this.tokenStorage.hasValidToken() ? this.tokenStorage.getToken()?.accessToken : undefined;
    auth.passed = typeof token === 'string' && !!token && !/^(mock_|test_|upstox_sand_|upstox_ref_)/i.test(token);
    auth.verifiedAt = auth.passed ? new Date().toISOString() : null;
    auth.evidence = auth.passed ? 'Genuine-format token locally present and unexpired; broker verification occurs before entry.' : 'Genuine token unavailable.';
    const allPassed = this.items.every((item) => item.passed);
    return { allPassed, items: structuredClone(this.items), signedOffBy: this.signedOffBy, signedOffAt: this.signedOffAt,
      liveExecutionPermitted: allPassed && !!this.signedOffAt && this.envService.config.LIVE_EXECUTION_ENABLED };
  }
  public signOffItem(id: string, evidence?: string): GoLiveChecklistItem {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new BadRequestException(`Checklist item '${id}' not found.`);
    if (!evidence || evidence.trim().length < 12) throw new BadRequestException('Explicit verification evidence is required; no checklist item is automatically asserted as passed.');
    if (id === 'chk_04_auth') {
      if (!this.getChecklist().items.find((candidate) => candidate.id === id)!.passed) throw new BadRequestException('Genuine OAuth token is not locally valid.');
    } else { item.passed = true; item.verifiedAt = new Date().toISOString(); item.evidence = evidence.trim(); }
    this.signedOffBy = null; this.signedOffAt = null; this.persist(); return { ...item };
  }
  public completeChecklist(signedOffBy = 'Platform Owner'): GoLiveChecklist {
    if (!this.getChecklist().allPassed) throw new BadRequestException('All verification checks must contain owner evidence and the genuine token check must pass before sign-off.');
    if (!signedOffBy.trim()) throw new BadRequestException('An owner identity is required for sign-off.');
    this.signedOffBy = signedOffBy; this.signedOffAt = new Date().toISOString(); this.persist(); return this.getChecklist();
  }
  public isLiveExecutionPermitted(): boolean { return this.getChecklist().liveExecutionPermitted; }
  private persist(): void {
    if (!this.storagePath) return;
    const directory = path.dirname(this.storagePath); const temporary = path.join(directory, `.checklist-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(this.getChecklist())}\n`); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.storagePath); fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    } catch { this.signedOffAt = null; throw new ServiceUnavailableException('Owner evidence was not durably confirmed; live execution remains blocked.'); }
    finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
