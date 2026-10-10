import { Injectable, Inject } from '@nestjs/common';
import { DailyReport, OrderSide, TradeMode, Position } from '@trading-bot/contracts';
import { BrokerRouterService } from '../broker/broker-router.service';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { OrderFillEvent } from '../broker/paper-broker.adapter';

export function buildFillReport(fills: OrderFillEvent[], positions: Position[], mode: TradeMode, capitalDeployed: number, tradingDay: string): DailyReport {
  const day = (time: string) => new Date(Date.parse(time) + 330 * 60000).toISOString().slice(0,10);
  const unique = Array.from(new Map(fills.map(fill => [fill.id,fill])).values())
    .sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const inventory = new Map<string, { quantity: number; price: number; chargesPerUnit: number }[]>();
  let realizedGrossPnl = 0, realizedNetPnl = 0, actualCharges = 0, estimatedCharges = 0;
  let winningTrades = 0, losingTrades = 0, totalTrades = 0, unmatchedSellQuantity = 0;
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const fill of unique) {
    if (![fill.fillQty,fill.fillPrice,fill.actualCharges,fill.estimatedCharges].every(Number.isFinite) || fill.fillQty <= 0 || fill.fillPrice <= 0 || !Number.isFinite(Date.parse(fill.timestamp))) throw new Error('Fill ledger contains invalid quantity, price, time or fees.');
    const today = day(fill.timestamp) === tradingDay;
    if (today) { actualCharges += fill.actualCharges; estimatedCharges += fill.estimatedCharges; }
    const lots = inventory.get(fill.instrumentKey) ?? [];
    if (fill.side === OrderSide.BUY) {
      lots.push({quantity:fill.fillQty,price:fill.fillPrice,chargesPerUnit:fill.actualCharges/fill.fillQty});
      inventory.set(fill.instrumentKey,lots);
      continue;
    }
    let remaining = fill.fillQty, gross = 0, costs = 0, matched = 0;
    while (remaining > 0 && lots.length) {
      const entry = lots[0]!;
      const quantity = Math.min(remaining,entry.quantity);
      gross += (fill.fillPrice-entry.price)*quantity;
      costs += entry.chargesPerUnit*quantity + fill.actualCharges/fill.fillQty*quantity;
      matched += quantity; remaining -= quantity; entry.quantity -= quantity;
      if (entry.quantity === 0) lots.shift();
    }
    if (today) {
      unmatchedSellQuantity += remaining;
      if (matched > 0) {
        const net = gross-costs;
        realizedGrossPnl += gross; realizedNetPnl += net; totalTrades++;
        if (net > 0) winningTrades++; else losingTrades++;
        equity += net; peak = Math.max(peak,equity); maxDrawdown = Math.max(maxDrawdown,peak-equity);
      }
    }
    inventory.set(fill.instrumentKey,lots);
  }
  const round = (value: number) => Number(value.toFixed(2));
  return { tradingDay,mode,realizedGrossPnl:round(realizedGrossPnl),realizedNetPnl:round(realizedNetPnl),
    actualCharges:round(actualCharges),estimatedCharges:round(estimatedCharges),
    unrealizedPnl:round(positions.reduce((sum,position)=>sum+position.unrealizedPnl,0)),
    totalTrades,winningTrades,losingTrades,maxDrawdown:round(maxDrawdown),capitalDeployed,
    chargesSource:mode===TradeMode.PAPER?'SIMULATED':unique.every(fill=>(fill as any).chargesSource==='BROKER_CONFIRMED') && unique.length>0?'BROKER_CONFIRMED':'ESTIMATED',
    dataSource:mode===TradeMode.PAPER?'PAPER_SIMULATION':'LIVE_BROKER',unmatchedSellQuantity };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(BrokerRouterService) private readonly broker: BrokerRouterService,
    @Inject(RiskReservationManager) private readonly reservations: RiskReservationManager) {}
  async getDailyReport(): Promise<DailyReport> {
    const positions = await this.broker.getPositions();
    const today = new Date(Date.now()+330*60000).toISOString().slice(0,10);
    return buildFillReport(this.broker.getFills(),positions,this.broker.isLive()?TradeMode.APPROVAL:TradeMode.PAPER,this.reservations.getTotalReservedCapital(),today);
  }
  generateCsvExport(): {csvContent:string;filename:string} {
    const fills = this.broker.getFills();
    const columns = ['Fill ID','Timestamp','Instrument Key','Side','Quantity','Fill Price (INR)','Estimated Fees (INR)','Reported Fees (INR)','Fees Source'];
    const quote = (value: unknown) => '"' + String(value).replace(/"/g,'""') + '"';
    const rows = fills.map(fill => [fill.id,fill.timestamp,fill.instrumentKey,fill.side,fill.fillQty,fill.fillPrice,fill.estimatedCharges,fill.actualCharges,(fill as any).chargesSource ?? (this.broker.isLive()?'ESTIMATED':'SIMULATED')].map(quote).join(','));
    return {csvContent:[columns.map(quote).join(','),...rows].join('\r\n'),filename:'trading-fills-'+new Date(Date.now()+330*60000).toISOString().slice(0,10)+'.csv'};
  }
}
