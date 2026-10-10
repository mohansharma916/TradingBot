import 'reflect-metadata';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {EnvSchema,ProposalStatus,OrderStatus,ExitProtectionStatus,TradeMode} from '@trading-bot/contracts';
import {AutonomousExecutionService} from '../orders/autonomous-execution.service';
import {StrategiesService} from '../strategies/strategies.service';
import {ProposalsService} from '../proposals/proposals.service';
import {RiskReservationManager} from '../risk/risk-reservation.manager';
import {TradingModeService} from '../trading/trading-mode.service';

describe('bounded autonomy with verified evidence',()=>{
  let service:AutonomousExecutionService, strategies:StrategiesService, proposals:ProposalsService, risk:RiskReservationManager;
  let feed:any, supervised:any, mode:TradingModeService;
  const gateway={broadcast:vi.fn()} as any;
  const env={config:EnvSchema.parse({NODE_ENV:'test'})} as any;
  const request=()=>({strategyId:strategies.getAllStrategies()[0]!.id,windowMinutes:30,maxSessionTrades:1,confirmationCode:'CONFIRM_AUTO_EXECUTION',operatorConsent:true});
  beforeEach(()=>{
    mode=new TradingModeService(env);
    risk=new RiskReservationManager(env,gateway,mode);
    proposals=new ProposalsService(gateway);
    strategies=new StrategiesService({} as any,proposals);
    feed={getFeedHealth:()=>({status:'DISCONNECTED',provenance:'UNAVAILABLE',totalTicksReceived:0,staleCount:0,feedLatencyMs:0})};
    supervised={executeSupervisedProposal:vi.fn().mockResolvedValue({orderId:'paper-confirmed',filledQuantity:65,orderStatus:OrderStatus.FILLED,protectionStatus:ExitProtectionStatus.PROTECTED_VIRTUAL})};
    service=new AutonomousExecutionService(env,{getChecklist:()=>({items:[],signedOffAt:null}),isLiveExecutionPermitted:()=>false} as any,
      {runReconciliation:async()=>({discrepancies:[]})} as any,
      {getTokenMetadata:()=>({exists:false,isExpired:true,secondsRemaining:0})} as any,
      feed,strategies,proposals,supervised,risk,gateway,{dispatchAlert:vi.fn()} as any,
      {getFills:()=>[],getPositions:async()=>[],getOrders:async()=>[]} as any,mode);
  });
  afterEach(()=>{service.disarmAutonomous('Test teardown');vi.restoreAllMocks();});
  const permitFixtureReadiness=()=>vi.spyOn(service,'checkReadiness').mockResolvedValue({isEligibleForAuto:true,items:[],evaluatedAt:new Date().toISOString(),summary:'Explicit isolated unit-test readiness fixture'});
  function addProposal(overrides:any={}){
    const strategy=strategies.getAllStrategies()[0]!;
    const proposal={id:'550e8400-e29b-41d4-a716-446655440010',strategyId:strategy.id,strategyVersion:strategy.version,versionHash:strategy.versionHash,proposingAgent:'STRATEGY_ANALYST',instrumentKey:'NSE_FO|52175',symbol:'Fixture',side:'BUY',product:'I',suggestedEntryPrice:100,suggestedStopPrice:95,suggestedTargetPrice:110,lotSize:65,quantity:65,estimatedCapitalRequired:6500,estimatedRoundTripCosts:60,allInMaxLoss:385,estimatedNetProfit:590,evidence:{indicators:{closedBars:40},rationale:'Explicit test fixture',confidence:0.6},status:ProposalStatus.PENDING,expiresAt:new Date(Date.now()+180000).toISOString(),createdAt:new Date().toISOString(),...overrides};
    proposals.addProposal(proposal as any);return proposal;
  }
  it('empty feed never passes merely because staleCount is zero',async()=>{
    const result=await service.checkReadiness();
    expect(result.isEligibleForAuto).toBe(false);
    expect(result.items.find(item=>item.id==='auto_06')?.passed).toBe(false);
    await expect(service.armAutonomous(request())).rejects.toThrow('AUTONOMOUS_EXECUTION_BLOCKED');
  });
  it('Live requires owner evidence and multiple actual paper days',async()=>{
    vi.spyOn(mode,'isLive').mockReturnValue(true);
    const result=await service.checkReadiness();
    expect(result.items.filter(item=>['auto_01','auto_02','auto_03','auto_05'].includes(item.id)).every(item=>!item.passed)).toBe(true);
  });
  it('requires explicit consent and arms/disarms the shared entry gate',async()=>{
    permitFixtureReadiness();
    await expect(service.armAutonomous({...request(),operatorConsent:false})).rejects.toThrow('Invalid confirmation');
    await service.armAutonomous(request());expect(risk.isArmed()).toBe(true);
    service.disarmAutonomous('Owner stop');expect(risk.isArmed()).toBe(false);
    expect(service.getSessionStatus().isArmed).toBe(false);
  });
  it('rejects a proposal with a different strategy hash before approval or dispatch',async()=>{
    permitFixtureReadiness();const proposal=addProposal({versionHash:'old-version'});
    await service.armAutonomous(request());
    await expect(service.executeAutonomousProposal(proposal.id)).rejects.toThrow('exact armed strategy');
    expect(supervised.executeSupervisedProposal).not.toHaveBeenCalled();
    expect(proposals.getProposal(proposal.id)?.status).toBe(ProposalStatus.PENDING);
  });
  it('counts confirmed fills and describes returned protection without inventing a GTT',async()=>{
    permitFixtureReadiness();const proposal=addProposal();await service.armAutonomous(request());
    await service.executeAutonomousProposal(proposal.id);
    expect(service.getSessionStatus()).toMatchObject({tradesExecutedInSession:1,isArmed:false,lastDisarmReason:'SESSION_TRADE_CAP_REACHED'});
    expect(service.getExecutionLogs().find(log=>log.action==='ORDER_DISPATCHED')?.details).toContain('FILLED');
    expect(service.getExecutionLogs().find(log=>log.action==='ORDER_DISPATCHED')?.details).not.toContain('GTT Exits armed');
  });
  it('kill switch blocks shared arming even with an isolated passing readiness fixture',async()=>{
    permitFixtureReadiness();risk.setKillSwitch(true);
    await expect(service.armAutonomous(request())).rejects.toThrow('Kill Switch');
  });
});
