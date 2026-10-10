import 'reflect-metadata';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EnvSchema,TradeMode} from '@trading-bot/contracts';
import {OwnerAuthService} from '../auth/owner-auth.service';
import {OwnerAuthGuard} from '../auth/owner-auth.guard';
import {EventsGateway} from '../websocket/events.gateway';
import {TradingModeService} from '../trading/trading-mode.service';
import {TradingController} from '../trading/trading.controller';
import {RuntimeLeaseService} from '../trading/runtime-lease.service';
import {RiskReservationManager} from '../risk/risk-reservation.manager';
import {AgentToolsService} from '../agents/agent-tools.service';

const credentials={NODE_ENV:'test',OWNER_PASSWORD:'private-test-owner-password',JWT_SECRET:'private-unit-test-signing-secret-123456'};
const fixtureFunds={availableCash:1234,usedMargin:200,source:'LIVE_BROKER',status:'VERIFIED',verifiedAt:new Date().toISOString()};
describe('authenticated owner account and server modes',()=>{
  let dir:string, env:any, mode:TradingModeService,risk:RiskReservationManager,live:any,broker:any,ledger:any,daily:any,controller:TradingController;
  beforeEach(()=>{
    dir=fs.mkdtempSync(path.join(os.tmpdir(),'trading-owner-fixture-'));
    env={config:EnvSchema.parse({...credentials,STATE_DIRECTORY:dir,LIVE_EXECUTION_ENABLED:true})};
    mode=new TradingModeService(env);
    risk=new RiskReservationManager(env,{broadcast:vi.fn()} as any,mode);
    live={getFunds:vi.fn().mockResolvedValue(fixtureFunds),getOrders:vi.fn().mockResolvedValue([]),getPositions:vi.fn().mockResolvedValue([])};
    broker={getPositions:vi.fn().mockResolvedValue([]),getOrders:vi.fn().mockResolvedValue([]),
      getFunds:vi.fn().mockResolvedValue({source:'PAPER_SIMULATION',status:'SIMULATED',availableCash:9980,usedMargin:0}),recoverLiveExposure:vi.fn()};
    ledger={hasUnresolvedExposure:()=>false};
    daily={snapshot:()=>({sessions:[]})};
    controller=new TradingController(mode,live,broker,ledger,risk,daily,env,{invalidateApprovals:vi.fn()} as any);
  });
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();fs.rmSync(dir,{recursive:true,force:true});});
  it('an unset owner password blocks login and prevents production startup',()=>{
    const config=EnvSchema.parse({NODE_ENV:'development',OWNER_PASSWORD:''});
    expect(config.OWNER_PASSWORD).toBeUndefined();
    expect(()=>new OwnerAuthService({config} as any).login('owner','')).toThrow('Configure OWNER_PASSWORD');
    expect(()=>new OwnerAuthService({config:{...config,NODE_ENV:'production'}} as any)).toThrow('Production requires OWNER_PASSWORD');
    expect(EnvSchema.safeParse({OWNER_PASSWORD:'short'}).success).toBe(false);
  });
  it('verifies owner credentials, rejects forged tokens and revokes logout',()=>{
    const auth=new OwnerAuthService(env);
    expect(()=>auth.login('owner','wrong')).toThrow('Invalid owner credentials');
    const {token}=auth.login('owner',credentials.OWNER_PASSWORD);
    expect(auth.verify(token).sub).toBe('owner');
    const pieces=token.split('.');pieces[1]=Buffer.from(JSON.stringify({sub:'owner',exp:99999999999})).toString('base64url');
    expect(()=>auth.verify(pieces.join('.'))).toThrow('Owner login required');
    auth.logout(token);expect(()=>auth.verify(token)).toThrow('Owner login required');
  });
  it('invalidates sessions after restart and expires the bounded owner JWT',()=>{
    vi.useFakeTimers();
    const auth=new OwnerAuthService(env),token=auth.login('owner',credentials.OWNER_PASSWORD).token;
    expect(()=>new OwnerAuthService(env).verify(token)).toThrow();
    vi.advanceTimersByTime(8*3600000+1);expect(()=>auth.verify(token)).toThrow();
  });
  it('guards account HTTP routes and websocket connections',()=>{
    const auth=new OwnerAuthService(env),guard=new OwnerAuthGuard(auth);
    const request:any={path:'/api/v1/orders',method:'GET',headers:{}};
    const context={getType:()=> 'http',switchToHttp:()=>({getRequest:()=>request})} as any;
    expect(()=>guard.canActivate(context)).toThrow('Owner login required');
    const token=auth.login('owner',credentials.OWNER_PASSWORD).token;
    request.headers.authorization='Bearer '+token;expect(guard.canActivate(context)).toBe(true);
    const gateway=new EventsGateway(auth,env),client={send:vi.fn(),close:vi.fn(),readyState:1} as any;
    gateway.handleConnection(client,{headers:{origin:'http://localhost:8081','sec-websocket-protocol':'owner, '+token}} as any);
    expect(client.send).toHaveBeenCalledOnce();
    auth.logout(token);gateway.broadcast('quote',{});expect(client.close).toHaveBeenCalledWith(1008,'Owner session expired');
    const stranger={send:vi.fn(),close:vi.fn()} as any;gateway.handleConnection(stranger,{headers:{}} as any);
    expect(stranger.close).toHaveBeenCalledWith(1008,'Owner login required');expect(stranger.send).not.toHaveBeenCalled();
  });
  it('Testing funds derive from its simulator ledger without querying Upstox',async()=>{
    const result=await controller.snapshot();
    expect(result).toMatchObject({label:'TESTING',funds:{availableCash:9980,source:'PAPER_SIMULATION'}});
    expect(live.getFunds).not.toHaveBeenCalled();
  });
  it('Live uses actual verified cash and margin and keeps entries disarmed',async()=>{
    risk.arm(30);
    const result=await controller.select({mode:TradeMode.APPROVAL});
    expect(result).toMatchObject({label:'LIVE',funds:{availableCash:1234,reservedMargin:200,totalCapital:1434,source:'LIVE_BROKER'}});
    expect(risk.isArmed()).toBe(false);expect(broker.recoverLiveExposure).toHaveBeenCalledOnce();
    expect(new TradingModeService(env).getSnapshot()).toMatchObject({mode:TradeMode.APPROVAL,funds:{status:'UNAVAILABLE',availableCash:0}});
  });
  it('zero broker cash stays zero; unavailable funds disarm instead of substituting paper capital',async()=>{
    live.getFunds.mockResolvedValue({...fixtureFunds,availableCash:0,usedMargin:0});
    expect((await controller.select({mode:TradeMode.APPROVAL})).funds.availableCash).toBe(0);
    risk.arm(30);live.getFunds.mockRejectedValue(new Error('Broker unavailable'));
    expect((await controller.snapshot()).funds).toMatchObject({availableCash:0,source:'UNAVAILABLE',status:'UNAVAILABLE'});
    expect(risk.isArmed()).toBe(false);
  });
  it('blocks disabled Live mode and exposure before selecting a different ledger',async()=>{
    env.config.LIVE_EXECUTION_ENABLED=false;
    await expect(controller.select({mode:TradeMode.APPROVAL})).rejects.toThrow('Live execution is disabled');
    env.config.LIVE_EXECUTION_ENABLED=true;broker.getPositions.mockResolvedValue([{netQuantity:65}]);
    await expect(controller.select({mode:TradeMode.APPROVAL})).rejects.toThrow('open positions');
    expect(mode.getMode()).toBe(TradeMode.PAPER);
  });
  it.each(['success','failure'])('ignores a late Testing funds %s after switching to Live',async(outcome)=>{
    let resolve!:(value:any)=>void, reject!:(reason:Error)=>void;
    broker.getFunds.mockImplementationOnce(()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
    const stale=controller.snapshot();
    await controller.select({mode:TradeMode.APPROVAL});
    risk.arm(30);
    if(outcome==='success') resolve({source:'PAPER_SIMULATION',status:'SIMULATED',availableCash:9980,usedMargin:0});
    else reject(new Error('Old paper read failed'));
    expect(await stale).toMatchObject({label:'LIVE',funds:{availableCash:1234,source:'LIVE_BROKER'}});
    expect(risk.getAvailableCash()).toBe(1234);expect(risk.isArmed()).toBe(true);
  });
  it('ignores an older Live balance after switching away and back to Live',async()=>{
    await controller.select({mode:TradeMode.APPROVAL});
    let resolve!:(value:any)=>void;
    live.getFunds.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
    const stale=controller.snapshot();
    await controller.select({mode:TradeMode.PAPER});
    await controller.select({mode:TradeMode.APPROVAL});
    resolve({...fixtureFunds,availableCash:9000});
    expect((await stale).funds.availableCash).toBe(1234);
    expect(risk.getAvailableCash()).toBe(1234);
    expect(()=>mode.updateFunds({availableCash:9980,reservedMargin:0,totalCapital:9980,source:'PAPER_SIMULATION',status:'VERIFIED',verifiedAt:null})).toThrow('currently selected');
  });
  it('restores the original risk ledger disarmed when persisting a mode change fails',async()=>{
    vi.spyOn(mode,'setMode').mockImplementation(()=>{throw new Error('Mode file write failed');});
    await expect(controller.select({mode:TradeMode.APPROVAL})).rejects.toThrow('Mode file write failed');
    expect(mode.getMode()).toBe(TradeMode.PAPER);
    expect(risk.getAvailableCash()).toBe(10000);expect(risk.isArmed()).toBe(false);
  });
  it('persists risk without restoring arming and blocks replayed cash settlement',()=>{
    expect(()=>risk.acquireReservation({proposalId:'x',signalKey:'x',instrumentKey:'NSE_FO|52175',capitalRequired:1000,allInRisk:100})).toThrow('disarmed');
    risk.arm(30);const reservation=risk.acquireReservation({proposalId:'x',signalKey:'x',instrumentKey:'NSE_FO|52175',capitalRequired:1000,allInRisk:100});
    const restarted=new RiskReservationManager(env,{broadcast:vi.fn()} as any,mode);
    expect(restarted.isArmed()).toBe(false);expect(restarted.getActiveReservations()).toHaveLength(1);
    expect(restarted.isKillSwitchActive()).toBe(true);
    risk.commitReservationToPosition(reservation.id,1000);risk.settleReservation(reservation.id,-100);
    const cash=risk.getAvailableCash();risk.settleReservation(reservation.id,-100);
    expect(risk.getAvailableCash()).toBe(cash);
  });
  it('takes the exclusive runtime lease before loading dispatch state',()=>{
    vi.stubEnv('VITEST','');
    const lease=new RuntimeLeaseService(env);
    try {expect(lease.isOwner()).toBe(true);expect(()=>new RuntimeLeaseService(env)).toThrow('Account runtime is locked');}
    finally {lease.onModuleDestroy();}
  });
  it('historical warmup uses V3 exact minutes and excludes the current unfinished bar',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T04:32:00Z'));
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'success',data:{candles:[
      ['2026-10-12T09:30:00+05:30',100,101,99,100.5,500],
      ['2026-10-12T10:00:00+05:30',100,101,99,100.5,500],
    ]}})));
    // Each endpoint needs its own readable response.
    fetch.mockImplementation(async()=>new Response(JSON.stringify({status:'success',data:{candles:[
      ['2026-10-12T09:30:00+05:30',100,101,99,100.5,500],['2026-10-12T10:00:00+05:30',100,101,99,100.5,500],
    ]}})));
    vi.stubGlobal('fetch',fetch);
    const tools=new AgentToolsService({} as any,{observeQuotes:()=>{}} as any,{getToken:()=>({accessToken:'fixture-broker-response-token'}),hasValidToken:()=>true} as any);
    await tools.hydrateHistory('NSE_INDEX|Nifty 50','5m');
    expect(fetch.mock.calls.some(([url])=>String(url).includes('/minutes/5/'))).toBe(true);
    expect(tools.getClosedCandles('NSE_INDEX|Nifty 50',true,'5m')).toHaveLength(1);
    expect(tools.getClosedCandles('NSE_INDEX|Nifty 50',true,'5m')[0]?.timestamp).toBe('2026-10-12T04:05:00.000Z');
  });
});
