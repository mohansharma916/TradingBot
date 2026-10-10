import { describe, expect, it } from 'vitest';
import { OrderSide, TradeMode } from '@trading-bot/contracts';
import { buildFillReport } from '../reports/reports.service';
import { OrderFillEvent } from '../broker/paper-broker.adapter';

function fill(side: OrderSide, price: number, quantity = 25, id = side): OrderFillEvent {
  return { id, orderId: id, instrumentKey: 'NSE_FO|52175', side, fillQty: quantity, fillPrice: price,
    timestamp: side === OrderSide.BUY ? '2026-10-09T05:00:00Z' : '2026-10-09T05:05:00Z',
    actualCharges: 20, estimatedCharges: 20, charges: { brokerage:20, stt:0, exchangeCharges:0, sebiCharges:0, stampDuty:0, gst:0, totalRoundTripCharges:20 } };
}
describe('matched confirmed fill reporting', () => {
  it('reports an actual trading loss rather than sell proceeds as profit', () => {
    const report = buildFillReport([fill(OrderSide.BUY,100),fill(OrderSide.SELL,90)],[],TradeMode.PAPER,0,'2026-10-09');
    expect(report.realizedGrossPnl).toBe(-250);
    expect(report.realizedNetPnl).toBe(-290);
    expect(report.maxDrawdown).toBe(290);
    expect(report.winningTrades).toBe(0);
    expect(report.losingTrades).toBe(1);
  });
  it('has no fabricated profit, trades or deployed capital for empty or BUY-only ledgers', () => {
    const empty = buildFillReport([],[],TradeMode.PAPER,0,'2026-10-09');
    expect(empty.totalTrades).toBe(0); expect(empty.maxDrawdown).toBe(0); expect(empty.capitalDeployed).toBe(0);
    const buy = buildFillReport([fill(OrderSide.BUY,100)],[],TradeMode.PAPER,2500,'2026-10-09');
    expect(buy.realizedNetPnl).toBe(0); expect(buy.totalTrades).toBe(0);
  });
  it('keeps unknown entry cost unavailable instead of inventing a profitable sell', () => {
    const report = buildFillReport([fill(OrderSide.SELL,90)],[],TradeMode.APPROVAL,0,'2026-10-09');
    expect(report.realizedGrossPnl).toBe(0); expect(report.totalTrades).toBe(0);
    expect(report.unmatchedSellQuantity).toBe(25); expect(report.chargesSource).toBe('ESTIMATED');
  });
});
