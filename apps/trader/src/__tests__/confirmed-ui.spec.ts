import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { TradeProposalSchema, PositionSchema, TradeMode, OrderFillEventSchema } from '@trading-bot/contracts';

const api = vi.hoisted(() => ({ getPendingProposals: vi.fn(), getAgentTasks: vi.fn(), approveProposal: vi.fn(),
  rejectProposal: vi.fn(), getOrders: vi.fn(), getPositions: vi.fn(), getOrderFills: vi.fn(),
  getRiskStatus: vi.fn(), getGoLiveChecklist: vi.fn(), closePosition: vi.fn(), workstationState: {} as any }));
vi.mock('../services/api', () => ({ apiClient: api }));
vi.mock('../hooks/useWorkstation', () => ({ useWorkstation: () => ({ state: api.workstationState }) }));
import ProposalsScreen from '../../app/proposals';
import OrdersScreen from '../../app/orders';
import RiskCenterScreen from '../../app/risk';

const proposal = TradeProposalSchema.parse({
  id: '550e8400-e29b-41d4-a716-446655440001', strategyId: '550e8400-e29b-41d4-a716-446655440002',
  strategyVersion: 2, proposingAgent: 'STRATEGY_ANALYST', instrumentKey: 'NSE_FO|52175', symbol: 'TEST_CONTRACT_65',
  side: 'BUY', product: 'I', suggestedEntryPrice: 100, suggestedStopPrice: 98, suggestedTargetPrice: 104,
  lotSize: 65, quantity: 65, estimatedCapitalRequired: 6500, estimatedRoundTripCosts: 50,
  allInMaxLoss: 180, estimatedNetProfit: 210, evidence: { indicators: { rsiCustom: 13.25, contractVolume: 310 },
    rationale: 'Measured fixture evidence from the API.', confidence: 0.66 },
  expiresAt: new Date(Date.now() + 180000).toISOString(), createdAt: new Date().toISOString(),
});
const position = PositionSchema.parse({
  id: '550e8400-e29b-41d4-a716-446655440003', instrumentKey: 'NSE_FO|52175', symbol: 'TEST_CONTRACT_65',
  netQuantity: 65, buyQuantity: 65, sellQuantity: 0, buyAvgPrice: 100, sellAvgPrice: 0,
  lastPrice: 101, unrealizedPnl: 65, realizedPnl: 0, lastVerifiedAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('React', React);
  api.workstationState = { mode: TradeMode.PAPER, riskState: 'DISARMED', isLiveSynced: false,
    totalCapital: 0, availableCash: 0, realizedNetDailyPnl: 0, dailyLossCap: 0, maxAllInTradeLoss: 0,
    targetDailyProfit: 0, openPositionsCount: 0, activeReservationsCount: 0, egressIpVerified: false };
  api.getPendingProposals.mockResolvedValue([proposal]); api.getAgentTasks.mockResolvedValue([]);
  api.getPositions.mockResolvedValue([position]); api.getOrders.mockResolvedValue([]); api.getOrderFills.mockResolvedValue([]);
  api.getRiskStatus.mockResolvedValue({ availableCash: 3500, reservedCapital: 6500, remainingDailyRiskBudget: 600 });
  api.getGoLiveChecklist.mockResolvedValue({ items: [], signedOffBy: null, signedOffAt: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Confirmed proposal evidence and execution feedback', () => {
  it('identifies estimated fee records without inventing actual levies or savings', async () => {
    api.workstationState.mode = TradeMode.APPROVAL;
    api.getOrderFills.mockResolvedValue([OrderFillEventSchema.parse({ id: 'fill-1', orderId: 'order-1',
      instrumentKey: 'NSE_FO|52175', side: 'BUY', fillQty: 65, fillPrice: 100, timestamp: new Date().toISOString(),
      estimatedCharges: 75, actualCharges: 27, chargesSource: 'ESTIMATED',
      charges: { brokerage: 20, stt: 0, exchangeCharges: 3, sebiCharges: 0, stampDuty: 0.2, gst: 3.8, totalRoundTripCharges: 27 } })]);
    render(React.createElement(OrdersScreen));
    await screen.findByRole('button', { name: 'Fill Ledger & Fees (1)' });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Ledger & Fees (1)' }));
    expect(screen.getByText('REPORTED FEES')).toBeTruthy();
    expect(screen.getByText('REPORTED CHARGES')).toBeTruthy();
    expect(screen.getAllByText('ESTIMATED').length).toBeGreaterThan(0);
    expect(screen.queryByText(/ACTUAL STATUTORY LEVIES|ACTUAL CHARGES|FEE VARIANCE SAVINGS|saved$/)).toBeNull();
  });

  it('keeps unknown risk exposure unavailable instead of labeling the account flat', () => {
    render(React.createElement(RiskCenterScreen));
    expect(screen.getByText('EXPOSURE UNAVAILABLE')).toBeTruthy();
    expect(screen.queryByText('FLAT')).toBeNull();
    expect(screen.queryByText('NO OWNED EXPOSURE')).toBeNull();
  });
  it('renders the supplied indicators with a heuristic label and reports failed approval', async () => {
    api.approveProposal.mockRejectedValue(new Error('Approval API unavailable'));
    render(React.createElement(ProposalsScreen));
    await screen.findByText('Measured fixture evidence from the API.');
    expect(screen.getByText('13.25')).toBeTruthy();
    expect(screen.getByText('HEURISTIC SCORE')).toBeTruthy();
    expect(screen.queryByText('CALIBRATED CONFIDENCE')).toBeNull();
    expect(screen.queryByText(/25,115|25,102|45,000/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Authorize Trade Proposal' }));
    await screen.findByText('Approval API unavailable');
    expect(screen.queryByText('AUTHORIZED')).toBeNull();
    expect(api.getPendingProposals).toHaveBeenCalledOnce();
  });

  it('retains the actual 65-unit position and does not claim protection or closure after failure', async () => {
    api.closePosition.mockRejectedValue(new Error('Close not confirmed by broker'));
    render(React.createElement(OrdersScreen));
    await screen.findByText('65 units');
    expect(screen.getByText('PROTECTION UNVERIFIED')).toBeTruthy();
    expect(screen.queryByText('GTT PROTECTED')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Market Close Position' }));
    await screen.findByText('Close not confirmed by broker');
    expect(screen.getByText('65 units')).toBeTruthy();
    expect(api.getPositions).toHaveBeenCalledOnce();
  });
});
