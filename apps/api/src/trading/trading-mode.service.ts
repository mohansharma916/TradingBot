import { Inject, Injectable } from '@nestjs/common';
import { AccountFunds, TradeMode, TradingModeSnapshot } from '@trading-bot/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { EnvService } from '../config/env.service';

@Injectable()
export class TradingModeService {
  private mode = TradeMode.PAPER;
  private funds: AccountFunds;
  private error: string | null = null;
  private readonly storage: string | null;

  constructor(@Inject(EnvService) private readonly env: EnvService) {
    this.storage = process.env.VITEST && (!env.config.STATE_DIRECTORY || env.config.STATE_DIRECTORY === '.data') ? null : path.resolve(env.config.STATE_DIRECTORY ?? '.data', 'trading-mode.json');
    this.funds = this.paperFunds();
    if (this.storage && fs.existsSync(this.storage)) {
      const saved = JSON.parse(fs.readFileSync(this.storage, 'utf8')) as { mode: TradeMode };
      if (![TradeMode.PAPER, TradeMode.APPROVAL].includes(saved.mode)) throw new Error('Invalid persisted trading mode. Repair state before trading.');
      this.mode = saved.mode;
      if (this.isLive()) this.markFundsUnavailable('Live balance must be verified after restart.');
    }
  }

  getMode(): TradeMode { return this.mode; }
  isLive(): boolean { return this.mode !== TradeMode.PAPER; }
  getSnapshot(): TradingModeSnapshot {
    return { mode: this.mode, label: this.isLive() ? 'LIVE' : 'TESTING', liveExecutionEnabled: this.env.config.LIVE_EXECUTION_ENABLED, funds: { ...this.funds }, error: this.error };
  }
  setMode(mode: TradeMode, funds?: AccountFunds): void {
    if (![TradeMode.PAPER, TradeMode.APPROVAL].includes(mode)) throw new Error('Choose Testing (PAPER) or Live (APPROVAL).');
    if (mode !== TradeMode.PAPER && (!this.env.config.LIVE_EXECUTION_ENABLED || funds?.status !== 'VERIFIED' || funds.source !== 'LIVE_BROKER')) throw new Error('Live mode requires enabled execution and verified Upstox funds.');
    if (this.storage) {
      fs.mkdirSync(path.dirname(this.storage), { recursive: true, mode: 0o700 });
      const temporary = `${this.storage}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ mode }), { mode: 0o600 });
      fs.renameSync(temporary, this.storage);
    }
    this.mode = mode;
    this.funds = mode === TradeMode.PAPER ? this.paperFunds() : { ...funds! };
    this.error = null;
  }
  updateFunds(funds: AccountFunds): void { this.funds = { ...funds }; this.error = null; }
  markFundsUnavailable(message: string): void {
    this.funds = { availableCash: 0, reservedMargin: 0, totalCapital: 0, source: 'UNAVAILABLE', status: 'UNAVAILABLE', verifiedAt: null };
    this.error = message;
  }
  private paperFunds(): AccountFunds {
    return { availableCash: this.env.config.MAX_ACCOUNT_CAPITAL_INR, totalCapital: this.env.config.MAX_ACCOUNT_CAPITAL_INR, reservedMargin: 0, source: 'PAPER_SIMULATION', status: 'VERIFIED', verifiedAt: new Date().toISOString() };
  }
}
