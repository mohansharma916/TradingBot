import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RiskState, TradeMode, RiskStatusSchema } from '@trading-bot/contracts';
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({path:path.resolve(__dirname,'../../../.env'),quiet:true});

/** Passive observer. The API's exclusive runtime lease owns all account dispatch. */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private riskState: RiskState = RiskState.DISARMED;
  private tradeMode: TradeMode = TradeMode.PAPER;
  private timer: NodeJS.Timeout | null = null;
  private token: string | null = null;
  private observing = false;
  private connected = false;
  private lastObservedAt: string | null = null;
  private error: string | null = null;
  async onModuleInit() {
    await this.observe();
    this.timer = setInterval(() => { void this.observe(); }, 10000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  public async observe(): Promise<void> {
    if (this.observing) return;
    this.observing = true;
    try {
      const base = process.env.TRADING_API_URL ?? 'http://127.0.0.1:4000/api/v1';
      if (!this.token) {
        if (!process.env.OWNER_PASSWORD) throw new Error('Owner login is not configured for the observer.');
        const response = await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username:process.env.OWNER_USERNAME ?? 'owner',password:process.env.OWNER_PASSWORD}),signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw new Error('API owner authentication failed.');
        const body = await response.json() as {token?:string};
        if (!body.token) throw new Error('API did not return an owner session.');
        this.token = body.token;
      }
      const response = await fetch(base+'/risk/status',{headers:{Authorization:'Bearer '+this.token},signal:AbortSignal.timeout(5000)});
      if (response.status === 401) this.token = null;
      if (!response.ok) throw new Error('API account status is unavailable.');
      const status = RiskStatusSchema.parse(await response.json());
      this.riskState = status.state; this.tradeMode = status.mode;
      this.lastObservedAt = new Date().toISOString(); this.connected = true; this.error = null;
    } catch (error) {
      this.connected = false; this.riskState = RiskState.DISARMED;
      this.error = error instanceof Error ? error.message : 'API status unavailable.';
    } finally { this.observing = false; }
  }
  public getStatus() {
    return {isLeader:false,role:'API_OBSERVER',connected:this.connected,riskState:this.riskState,tradeMode:this.tradeMode,
      lastObservedAt:this.lastObservedAt,error:this.error,uptime:process.uptime()};
  }
}
