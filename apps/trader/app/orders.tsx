import { useState } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import {
  BrokerOrder,
  Position,
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
  OrderFillEvent,
} from '@trading-bot/contracts';
import { useWorkstation } from '../src/hooks/useWorkstation';

type TabType = 'POSITIONS' | 'ORDERS' | 'JOURNAL';

export default function OrdersScreen() {
  const { state: workstationState } = useWorkstation();
  const [activeTab, setActiveTab] = useState<TabType>('POSITIONS');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Central Risk & Capital Reservation Simulation State
  const [reservedCapital, setReservedCapital] = useState<number>(3062.5);
  const [availableCash, setAvailableCash] = useState<number>(6937.5);
  const [remainingDailyRiskBudget, setRemainingDailyRiskBudget] = useState<number>(1229.3);

  // Active Positions
  const [positions, setPositions] = useState<Position[]>([
    {
      id: '550e8400-e29b-41d4-a716-446655440101',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      symbol: 'NIFTY26OCT25100CE',
      netQuantity: 25,
      buyQuantity: 25,
      sellQuantity: 0,
      buyAvgPrice: 122.5,
      sellAvgPrice: 0,
      lastPrice: 125.8,
      unrealizedPnl: 82.5,
      realizedPnl: 0,
      stopLossPrice: 114.0,
      targetPrice: 136.0,
      lastVerifiedAt: new Date().toISOString(),
    },
  ]);

  // Order Book
  const [orders, setOrders] = useState<BrokerOrder[]>([
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      intentId: '550e8400-e29b-41d4-a716-446655440002',
      brokerOrderId: 'UPSTOX_SIM_98710',
      tag: 'SIG_1',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      product: ProductType.I,
      quantity: 25,
      price: 122.5,
      status: OrderStatus.FILLED,
      filledQuantity: 25,
      averageFillPrice: 122.5,
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      updatedAt: new Date(Date.now() - 1798000).toISOString(),
    },
  ]);

  // Trade Journal & Statutory Fill Ledger
  const [fills, setFills] = useState<OrderFillEvent[]>([
    {
      id: '550e8400-e29b-41d4-a716-446655440010',
      orderId: '550e8400-e29b-41d4-a716-446655440001',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE',
      side: OrderSide.BUY,
      fillQty: 25,
      fillPrice: 122.5,
      estimatedCharges: 58.2,
      actualCharges: 52.27,
      charges: {
        brokerage: 40.0,
        stt: 3.13,
        exchangeCharges: 1.57,
        sebiCharges: 0.0,
        stampDuty: 0.09,
        gst: 7.48,
        totalRoundTripCharges: 52.27,
      },
      timestamp: new Date(Date.now() - 1798000).toISOString(),
    },
  ]);

  const showNotification = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Close open position simulation
  const handleClosePosition = (instrumentKey: string) => {
    const pos = positions.find((p) => p.instrumentKey === instrumentKey);
    if (!pos || pos.netQuantity <= 0) return;

    const exitPrice = pos.lastPrice;
    const exitQty = pos.netQuantity;
    const grossPnl = (exitPrice - pos.buyAvgPrice) * exitQty;
    const actualCharges = 52.35;
    const netPnl = grossPnl - actualCharges;

    // Release reservation
    setReservedCapital(0);
    setAvailableCash((prev) => prev + pos.buyAvgPrice * exitQty + netPnl);
    setRemainingDailyRiskBudget((prev) => prev + (netPnl < 0 ? netPnl : 0));

    // Update position
    setPositions((prev) =>
      prev.map((p) =>
        p.instrumentKey === instrumentKey
          ? {
              ...p,
              netQuantity: 0,
              sellQuantity: exitQty,
              sellAvgPrice: exitPrice,
              unrealizedPnl: 0,
              realizedPnl: netPnl,
              lastVerifiedAt: new Date().toISOString(),
            }
          : p,
      ),
    );

    // Create exit order
    const exitOrderId = '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000);
    const exitOrder: BrokerOrder = {
      id: exitOrderId,
      intentId: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
      brokerOrderId: `UPSTOX_SIM_${Math.floor(10000 + Math.random() * 90000)}`,
      tag: 'EXIT_MANUAL',
      instrumentKey,
      side: OrderSide.SELL,
      orderType: OrderType.MARKET,
      product: ProductType.I,
      quantity: exitQty,
      price: exitPrice,
      status: OrderStatus.FILLED,
      filledQuantity: exitQty,
      averageFillPrice: exitPrice,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setOrders((prev) => [exitOrder, ...prev]);

    // Record exit fill
    const exitFill: OrderFillEvent = {
      id: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
      orderId: exitOrderId,
      instrumentKey,
      side: OrderSide.SELL,
      fillQty: exitQty,
      fillPrice: exitPrice,
      estimatedCharges: 58.2,
      actualCharges,
      charges: {
        brokerage: 40.0,
        stt: 3.15,
        exchangeCharges: 1.62,
        sebiCharges: 0.0,
        stampDuty: 0.0,
        gst: 7.49,
        totalRoundTripCharges: actualCharges,
      },
      timestamp: new Date().toISOString(),
    };
    setFills((prev) => [exitFill, ...prev]);

    showNotification(
      `Position ${pos.symbol} closed at ₹${exitPrice.toFixed(2)}. Net P&L: ₹${netPnl.toFixed(2)}. Capital reservation released.`,
    );
  };

  // Simulate new Paper Buy Order
  const handleSimulatePaperOrder = (partial = false) => {
    if (availableCash < 3062.5) {
      showNotification('Risk Gate Block: Insufficient available capital (Max ₹10,000 constraint).');
      return;
    }

    const newOrderId = '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000);
    const orderQty = 25;
    const filledQty = partial ? 15 : 25;
    const fillPrice = 123.0;

    // Transactional reservation
    setReservedCapital((prev) => prev + 3062.5);
    setAvailableCash((prev) => prev - 3062.5);

    const newOrder: BrokerOrder = {
      id: newOrderId,
      intentId: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
      brokerOrderId: `UPSTOX_SIM_${Math.floor(10000 + Math.random() * 90000)}`,
      tag: 'SIM_MANUAL',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25150_CE',
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      product: ProductType.I,
      quantity: orderQty,
      price: 122.5,
      status: partial ? OrderStatus.PARTIALLY_FILLED : OrderStatus.FILLED,
      filledQuantity: filledQty,
      averageFillPrice: fillPrice,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setOrders((prev) => [newOrder, ...prev]);

    const newFill: OrderFillEvent = {
      id: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
      orderId: newOrderId,
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25150_CE',
      side: OrderSide.BUY,
      fillQty: filledQty,
      fillPrice,
      estimatedCharges: 58.2,
      actualCharges: 52.3,
      charges: {
        brokerage: 40.0,
        stt: 3.14,
        exchangeCharges: 1.58,
        sebiCharges: 0.0,
        stampDuty: 0.09,
        gst: 7.49,
        totalRoundTripCharges: 52.3,
      },
      timestamp: new Date().toISOString(),
    };
    setFills((prev) => [newFill, ...prev]);

    // Update positions
    setPositions((prev) => [
      {
        id: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
        instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25150_CE',
        symbol: 'NIFTY26OCT25150CE',
        netQuantity: filledQty,
        buyQuantity: filledQty,
        sellQuantity: 0,
        buyAvgPrice: fillPrice,
        sellAvgPrice: 0,
        lastPrice: fillPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        stopLossPrice: 115.0,
        targetPrice: 137.0,
        lastVerifiedAt: new Date().toISOString(),
      },
      ...prev,
    ]);

    showNotification(
      partial
        ? `Paper Partial Fill executed: ${filledQty}/${orderQty} Qty filled at ₹${fillPrice}. Status: PARTIALLY_FILLED.`
        : `Paper Order executed: ${filledQty} Qty filled at ₹${fillPrice}. Status: FILLED.`,
    );
  };

  // Simulate Stale Quote Rejection
  const handleSimulateStaleRejection = () => {
    const newOrderId = '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000);
    const rejectedOrder: BrokerOrder = {
      id: newOrderId,
      intentId: '550e8400-e29b-41d4-a716-' + Math.floor(100000000000 + Math.random() * 900000000000),
      brokerOrderId: null,
      tag: 'SIM_STALE',
      instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_PE',
      side: OrderSide.BUY,
      orderType: OrderType.LIMIT,
      product: ProductType.I,
      quantity: 25,
      price: 110.0,
      status: OrderStatus.REJECTED,
      filledQuantity: 0,
      averageFillPrice: 0,
      rejectionReason: 'REJECTED_STALE_FEED: Market quote latency exceeded 3,000ms safety threshold.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setOrders((prev) => [rejectedOrder, ...prev]);
    showNotification('Order rejected by Paper Broker Stale Quote Gate (Latency > 3,000ms). Capital preserved.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            backgroundColor: colors.surfaceElevated,
            border: `1px solid ${colors.cyan}`,
            borderRadius: borderRadius.md,
            padding: `${spacing.sm}px ${spacing.md}px`,
            color: colors.textPrimary,
            fontSize: typography.fontSize.sm,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>⚡ {toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header & Badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
              Execution & Risk Ledger
            </h1>
            <Badge label="PAPER MODE" variant="purple" />
            <Badge
              label={workstationState.riskState === 'ARMED' ? 'ARMED' : 'DISARMED'}
              variant={workstationState.riskState === 'ARMED' ? 'success' : 'neutral'}
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Authoritative transactional reservations, simulated fills, GTT exits, and statutory charge reconciliation.
          </p>
        </div>

        {/* Tab Controls */}
        <div style={{ display: 'flex', gap: spacing.xs, backgroundColor: colors.surface, padding: 4, borderRadius: borderRadius.md, border: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setActiveTab('POSITIONS')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'POSITIONS' ? colors.cyan : 'transparent',
              color: activeTab === 'POSITIONS' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Positions ({positions.filter((p) => p.netQuantity > 0).length})
          </button>
          <button
            onClick={() => setActiveTab('ORDERS')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'ORDERS' ? colors.cyan : 'transparent',
              color: activeTab === 'ORDERS' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Orders ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('JOURNAL')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'JOURNAL' ? colors.cyan : 'transparent',
              color: activeTab === 'JOURNAL' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Fill Ledger & Fees ({fills.length})
          </button>
        </div>
      </div>

      {/* Central Risk & Reservation Status Widget */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: spacing.md,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          padding: spacing.md,
        }}
      >
        <div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Available Cash
          </div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, marginTop: 4 }}>
            ₹{availableCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
            Account Cap: ₹10,000.00
          </div>
        </div>

        <div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Reserved Capital
          </div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: reservedCapital > 0 ? colors.warning : colors.textMuted, marginTop: 4 }}>
            ₹{reservedCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
            Central transactional lock
          </div>
        </div>

        <div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Daily Risk Budget
          </div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: remainingDailyRiskBudget > 500 ? colors.profit : colors.loss, marginTop: 4 }}>
            ₹{remainingDailyRiskBudget.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
            Drawdown Cap: ₹1,500.00
          </div>
        </div>

        <div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Max All-In Trade Loss
          </div>
          <div style={{ fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.cyan, marginTop: 4 }}>
            ₹500.00
          </div>
          <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
            Hard stop per trade
          </div>
        </div>
      </div>

      {/* Simulator Test Bench Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.sm,
          backgroundColor: colors.surfaceElevated,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          padding: `${spacing.sm}px ${spacing.md}px`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold }}>
            Paper Simulation Testbench:
          </span>
          <span style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>
            Verify fills, partial executions & risk gates directly
          </span>
        </div>

        <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleSimulatePaperOrder(false)}
            style={{
              padding: `${spacing.xs}px ${spacing.sm}px`,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.cyan}`,
              color: colors.cyan,
              borderRadius: borderRadius.sm,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.semibold,
              cursor: 'pointer',
            }}
          >
            + Test Buy 25 Qty
          </button>
          <button
            onClick={() => handleSimulatePaperOrder(true)}
            style={{
              padding: `${spacing.xs}px ${spacing.sm}px`,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.warning}`,
              color: colors.warning,
              borderRadius: borderRadius.sm,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.semibold,
              cursor: 'pointer',
            }}
          >
            + Test Partial Fill (15 Qty)
          </button>
          <button
            onClick={handleSimulateStaleRejection}
            style={{
              padding: `${spacing.xs}px ${spacing.sm}px`,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.loss}`,
              color: colors.loss,
              borderRadius: borderRadius.sm,
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.semibold,
              cursor: 'pointer',
            }}
          >
            + Test Stale Feed Gate
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'POSITIONS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {positions.filter((p) => p.netQuantity > 0).length === 0 ? (
            <div
              style={{
                backgroundColor: colors.surface,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                padding: spacing.xl,
                textAlign: 'center',
                color: colors.textMuted,
              }}
            >
              <div style={{ fontSize: typography.fontSize.lg, marginBottom: spacing.xs }}>No Open Positions</div>
              <div style={{ fontSize: typography.fontSize.xs }}>
                All capital reservations have been released. Approve a Trade Proposal or trigger a test order above.
              </div>
            </div>
          ) : (
            positions
              .filter((p) => p.netQuantity > 0)
              .map((pos) => {
                const pnl = (pos.lastPrice - pos.buyAvgPrice) * pos.netQuantity;
                const pnlPct = ((pos.lastPrice - pos.buyAvgPrice) / pos.buyAvgPrice) * 100;
                const isProfitable = pnl >= 0;

                return (
                  <div
                    key={pos.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: borderRadius.md,
                      border: `1px solid ${colors.border}`,
                      padding: spacing.lg,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: spacing.md,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing.sm }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                          <span style={{ fontWeight: typography.fontWeight.bold, fontSize: typography.fontSize.md }}>
                            {pos.symbol}
                          </span>
                          <Badge label="INTRADAY MIS" variant="primary" size="sm" />
                        </div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
                          {pos.instrumentKey}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: isProfitable ? colors.profit : colors.loss }}>
                          {isProfitable ? '+' : ''}₹{pnl.toFixed(2)} ({isProfitable ? '+' : ''}{pnlPct.toFixed(2)}%)
                        </div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>Unrealized MTM P&L</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: spacing.md }}>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>NET QUANTITY</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, marginTop: 2 }}>
                          {pos.netQuantity} ({Math.round(pos.netQuantity / 25)} Lot)
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>AVG BUY PRICE</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, marginTop: 2 }}>
                          ₹{pos.buyAvgPrice.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>CURRENT LTP</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, marginTop: 2 }}>
                          ₹{pos.lastPrice.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROTECTIVE STOP (GTT)</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.loss, marginTop: 2 }}>
                          ₹{pos.stopLossPrice?.toFixed(2) ?? 'None'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROFIT TARGET (GTT)</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.profit, marginTop: 2 }}>
                          ₹{pos.targetPrice?.toFixed(2) ?? 'None'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleClosePosition(pos.instrumentKey)}
                          style={{
                            padding: `${spacing.xs}px ${spacing.md}px`,
                            backgroundColor: colors.lossMuted,
                            color: colors.loss,
                            border: `1px solid ${colors.loss}`,
                            borderRadius: borderRadius.sm,
                            fontSize: typography.fontSize.xs,
                            fontWeight: typography.fontWeight.bold,
                            cursor: 'pointer',
                          }}
                        >
                          Market Close Position
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}

      {activeTab === 'ORDERS' && (
        <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
            <thead>
              <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                <th style={{ padding: spacing.sm }}>TIME</th>
                <th style={{ padding: spacing.sm }}>ORDER ID / TAG</th>
                <th style={{ padding: spacing.sm }}>INSTRUMENT</th>
                <th style={{ padding: spacing.sm }}>SIDE</th>
                <th style={{ padding: spacing.sm }}>PRODUCT</th>
                <th style={{ padding: spacing.sm }}>QTY</th>
                <th style={{ padding: spacing.sm }}>PRICE</th>
                <th style={{ padding: spacing.sm }}>STATUS</th>
                <th style={{ padding: spacing.sm }}>DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((ord) => {
                const isBuy = ord.side === OrderSide.BUY;
                return (
                  <tr key={ord.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                      {new Date(ord.createdAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      <div style={{ fontWeight: typography.fontWeight.semibold }}>{ord.tag}</div>
                      <div style={{ fontSize: '10px', color: colors.textMuted }}>{ord.brokerOrderId || ord.id.slice(0, 8)}</div>
                    </td>
                    <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                      {ord.instrumentKey.split('|')[1] || ord.instrumentKey}
                    </td>
                    <td style={{ padding: spacing.sm, color: isBuy ? '#60A5FA' : '#F87171', fontWeight: typography.fontWeight.bold }}>
                      {ord.side}
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                      {ord.product} (MIS)
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      {ord.filledQuantity} / {ord.quantity}
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      ₹{ord.price?.toFixed(2) || 'MKT'}
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      {ord.status === OrderStatus.FILLED && <Badge label="FILLED" variant="success" size="sm" />}
                      {ord.status === OrderStatus.PARTIALLY_FILLED && <Badge label="PARTIAL" variant="warning" size="sm" />}
                      {ord.status === OrderStatus.REJECTED && <Badge label="REJECTED" variant="danger" size="sm" />}
                      {ord.status === OrderStatus.ACKNOWLEDGED && <Badge label="ACKNOWLEDGED" variant="primary" size="sm" />}
                    </td>
                    <td style={{ padding: spacing.sm, color: ord.rejectionReason ? colors.loss : colors.textMuted, fontSize: '11px' }}>
                      {ord.rejectionReason ? ord.rejectionReason : `Avg Fill: ₹${ord.averageFillPrice.toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'JOURNAL' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing.md }}>
            <h3 style={{ margin: 0, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold }}>
              Statutory Charge Accounting: Estimated vs Actual Fees
            </h3>
            <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
              Every proposal estimates round-trip friction. Executed fills calculate exact statutory levies (Brokerage, STT, Exchange Turnover, SEBI, Stamp Duty, GST).
            </p>
          </div>

          <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
              <thead>
                <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                  <th style={{ padding: spacing.sm }}>FILL TIME</th>
                  <th style={{ padding: spacing.sm }}>INSTRUMENT</th>
                  <th style={{ padding: spacing.sm }}>SIDE</th>
                  <th style={{ padding: spacing.sm }}>QTY @ PRICE</th>
                  <th style={{ padding: spacing.sm }}>ESTIMATED CHARGES</th>
                  <th style={{ padding: spacing.sm }}>ACTUAL CHARGES</th>
                  <th style={{ padding: spacing.sm }}>CHARGE BREAKDOWN</th>
                  <th style={{ padding: spacing.sm }}>VARIANCE</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => {
                  const variance = f.estimatedCharges - f.actualCharges;
                  return (
                    <tr key={f.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: spacing.sm, color: colors.textSecondary }}>
                        {new Date(f.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                        {f.instrumentKey.split('|')[1] || f.instrumentKey}
                      </td>
                      <td style={{ padding: spacing.sm, color: f.side === OrderSide.BUY ? '#60A5FA' : '#F87171', fontWeight: typography.fontWeight.bold }}>
                        {f.side}
                      </td>
                      <td style={{ padding: spacing.sm, fontWeight: typography.fontWeight.semibold }}>
                        {f.fillQty} @ ₹{f.fillPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: spacing.sm, color: colors.warning }}>
                        ₹{f.estimatedCharges.toFixed(2)}
                      </td>
                      <td style={{ padding: spacing.sm, color: colors.textPrimary, fontWeight: typography.fontWeight.bold }}>
                        ₹{f.actualCharges.toFixed(2)}
                      </td>
                      <td style={{ padding: spacing.sm, color: colors.textSecondary, fontSize: '11px' }}>
                        <div>Brokerage: ₹{f.charges.brokerage.toFixed(2)} | STT: ₹{f.charges.stt.toFixed(2)}</div>
                        <div>Exch: ₹{f.charges.exchangeCharges.toFixed(2)} | Stamp: ₹{f.charges.stampDuty.toFixed(2)} | GST: ₹{f.charges.gst.toFixed(2)}</div>
                      </td>
                      <td style={{ padding: spacing.sm, color: variance >= 0 ? colors.profit : colors.loss, fontWeight: typography.fontWeight.bold }}>
                        {variance >= 0 ? `+₹${variance.toFixed(2)} saved` : `-₹${Math.abs(variance).toFixed(2)} excess`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
