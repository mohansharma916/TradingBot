import { useState, useEffect } from 'react';
import { colors, spacing, borderRadius, typography, Badge } from '@trading-bot/ui';
import {
  BrokerOrder,
  Position,
  OrderStatus,
  OrderSide,
  OrderFillEvent,
  ExitProtectionStatus,
  GoLiveChecklistItem,
} from '@trading-bot/contracts';
import { useWorkstation } from '../src/hooks/useWorkstation';
import { apiClient } from '../src/services/api';

type TabType = 'POSITIONS' | 'ORDERS' | 'JOURNAL' | 'CHECKLIST';

export default function OrdersScreen() {
  const { state: workstationState } = useWorkstation();
  const [activeTab, setActiveTab] = useState<TabType>('POSITIONS');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeAlert, setActiveAlert] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Central Risk & Capital Reservation State
  const [reservedCapital, setReservedCapital] = useState<number>(0);
  const [availableCash, setAvailableCash] = useState<number>(0);
  const [remainingDailyRiskBudget, setRemainingDailyRiskBudget] = useState<number>(0);

  // Active Positions & Protection States
  const [positions, setPositions] = useState<(Position & { protectionStatus?: ExitProtectionStatus })[]>([]);

  // Order Book
  const [orders, setOrders] = useState<BrokerOrder[]>([]);

  // Trade Journal & Statutory Fill Ledger
  const [fills, setFills] = useState<OrderFillEvent[]>([]);

  const showNotification = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleExportCsv = async () => {
    try {
      const csv = await apiClient.exportDailyReportCsv();
      if (typeof document === 'undefined') throw new Error('CSV downloads are available in the web workstation.');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a'); link.href = url;
      link.download = 'daily_trading_report.csv'; link.click(); URL.revokeObjectURL(url);
      showNotification('Confirmed trade report downloaded.');
    } catch (failure) { setActiveAlert(failure instanceof Error ? failure.message : 'Report export failed.'); }
  };

  const handleClosePosition = async (instrumentKey: string) => {
    if (pendingAction) return;
    setPendingAction(true); setActiveAlert(null);
    try {
      const result = await apiClient.closePosition(instrumentKey);
      if (!result.success) throw new Error(result.message);
      const [positionList, orderList, fillList] = await Promise.all([apiClient.getPositions(), apiClient.getOrders(), apiClient.getOrderFills()]);
      setPositions(positionList); setOrders(orderList); setFills(fillList);
      showNotification(result.message);
    } catch (failure) { setActiveAlert(failure instanceof Error ? failure.message : 'Close request was not confirmed.'); }
    finally { setPendingAction(false); }
  };

  // Phase 5: 10-Item Go-Live Safety Checklist State
  const [checklistItems, setChecklistItems] = useState<GoLiveChecklistItem[]>([]);
  const [checklistSignedOffBy, setChecklistSignedOffBy] = useState<string | null>(null);
  const [checklistSignedOffAt, setChecklistSignedOffAt] = useState<string | null>(null);

  // Periodic sync with live backend API
  useEffect(() => {
    let isMounted = true;
    const syncOrdersData = async () => {
      try {
        const [orderList, posList, fillsList, riskData, checklistData] = await Promise.all([
          apiClient.getOrders(),
          apiClient.getPositions(),
          apiClient.getOrderFills(),
          apiClient.getRiskStatus(),
          apiClient.getGoLiveChecklist(),
        ]);
        if (isMounted) {
          if (orderList) setOrders(orderList);
          if (posList) setPositions(posList as any);
          if (fillsList) setFills(fillsList);
          if (riskData) {
            setAvailableCash(riskData.availableCash);
            setReservedCapital(riskData.reservedCapital);
            setRemainingDailyRiskBudget(riskData.remainingDailyRiskBudget);
            setIsLiveConnected(true);
          }
          if (checklistData) {
            setChecklistItems(checklistData.items);
            setChecklistSignedOffBy(checklistData.signedOffBy || null);
            setChecklistSignedOffAt(checklistData.signedOffAt || null);
          }
        }
      } catch (failure) {
        if (isMounted) { setIsLiveConnected(false); setActiveAlert(failure instanceof Error ? failure.message : 'Account data unavailable.'); }
      }
    };
    syncOrdersData();
    const interval = setInterval(syncOrdersData, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [workstationState.mode]);

  const handleSignOffItem = async (id: string) => {
    if (pendingAction) return; setPendingAction(true);
    try {
      const result = await apiClient.signOffChecklistItem(id, 'Verified by operator in workstation');
      setChecklistItems((items) => items.map((item) => item.id === id ? result : item));
      showNotification('Checklist verification recorded by the API.');
    } catch (failure) { setActiveAlert(failure instanceof Error ? failure.message : 'Checklist verification failed.'); }
    finally { setPendingAction(false); }
  };
  const handleCompleteChecklist = async () => {
    if (pendingAction) return; setPendingAction(true);
    try {
      const result = await apiClient.signOffGoLiveChecklist('Platform Owner');
      setChecklistItems(result.items); setChecklistSignedOffBy(result.signedOffBy || null); setChecklistSignedOffAt(result.signedOffAt || null);
      showNotification('Checklist sign-off recorded. Trading remains subject to account and execution gates.');
    } catch (failure) { setActiveAlert(failure instanceof Error ? failure.message : 'Checklist sign-off failed.'); }
    finally { setPendingAction(false); }
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

      {/* Safety Alert Banner */}
      {activeAlert && (
        <div
          style={{
            backgroundColor: colors.lossMuted,
            border: `1px solid ${colors.loss}`,
            borderRadius: borderRadius.md,
            padding: spacing.md,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: spacing.sm,
          }}
        >
          <div>
            <div style={{ fontWeight: typography.fontWeight.bold, color: colors.loss, fontSize: typography.fontSize.sm }}>
              ⚠️ SAFETY INTERVENTION REQUIRED
            </div>
            <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.xs, marginTop: 2 }}>
              {activeAlert}
            </div>
          </div>
          <button
            onClick={() => setActiveAlert(null)}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              backgroundColor: colors.surfaceElevated,
              color: colors.textPrimary,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              fontSize: typography.fontSize.xs,
              cursor: 'pointer',
              fontWeight: typography.fontWeight.semibold,
            }}
          >
            Acknowledge & Clear
          </button>
        </div>
      )}

      {/* Header & Badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <h1 style={{ margin: 0, fontSize: typography.fontSize.xxl, fontWeight: typography.fontWeight.bold }}>
              Execution & Protective Exit Ledger
            </h1>
            <Badge label="SUPERVISED APPROVAL MODE" variant="primary" />
            <Badge
              label={workstationState.riskState === 'ARMED' ? 'ARMED' : 'DISARMED'}
              variant={workstationState.riskState === 'ARMED' ? 'success' : 'neutral'}
            />
            <Badge
              label={isLiveConnected ? 'API CONNECTED' : 'ACCOUNT DATA UNAVAILABLE'}
              variant={isLiveConnected ? 'success' : 'purple'}
            />
          </div>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
            Owner-supervised execution, multi-leg GTT protection, order state tracking, and failure recovery.
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
          <button
            onClick={() => setActiveTab('CHECKLIST')}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: borderRadius.sm,
              backgroundColor: activeTab === 'CHECKLIST' ? colors.cyan : 'transparent',
              color: activeTab === 'CHECKLIST' ? '#082F49' : colors.textSecondary,
              fontWeight: typography.fontWeight.bold,
              border: 'none',
              cursor: 'pointer',
              fontSize: typography.fontSize.xs,
            }}
          >
            Go-Live Checklist ({checklistItems.filter((c) => c.passed).length}/10)
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

      <div style={{ color: colors.textSecondary }}>Entries are created from approved strategy proposals. Orders and protection states below reflect API responses.</div>
      {pendingAction && <div role="status">Waiting for API confirmation…</div>}

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
                All capital reservations released. Authorize a Trade Proposal or trigger a supervised test order above.
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
                          {pos.protectionStatus === ExitProtectionStatus.PROTECTED_GTT ? (
                            <Badge label="GTT PROTECTED" variant="success" size="sm" />
                          ) : (
                            <Badge label="UNPROTECTED" variant="danger" size="sm" />
                          )}
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
                        <div style={{ fontSize: '10px', color: colors.textMuted }}>Limit trigger; not guaranteed</div>
                      </div>
                      <div>
                        <div style={{ fontSize: typography.fontSize.xs, color: colors.textMuted }}>PROFIT TARGET (GTT)</div>
                        <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.profit, marginTop: 2 }}>
                          ₹{pos.targetPrice?.toFixed(2) ?? 'None'}
                        </div>
                        <div style={{ fontSize: '10px', color: colors.textMuted }}>Limit order</div>
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
                <th style={{ padding: spacing.sm }}>PROTECTION & DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: spacing.xl, textAlign: 'center', color: colors.textMuted }}>
                    No orders executed today. Executed broker orders will appear here.
                  </td>
                </tr>
              ) : (
                orders.map((ord) => {
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
                      {/* Critical Invariant: ACK is NEVER labeled as FILLED */}
                      {ord.status === OrderStatus.ACKNOWLEDGED && (
                        <Badge label="ACKNOWLEDGED" variant="primary" size="sm" />
                      )}
                      {ord.status === OrderStatus.FILLED && (
                        <Badge label="FILLED" variant="success" size="sm" />
                      )}
                      {ord.status === OrderStatus.PROTECTED && (
                        <Badge label="PROTECTED (GTT)" variant="success" size="sm" />
                      )}
                      {ord.status === OrderStatus.PARTIALLY_FILLED && (
                        <Badge label="PARTIAL" variant="warning" size="sm" />
                      )}
                      {ord.status === OrderStatus.PROTECTION_FAILED && (
                        <Badge label="PROTECTION FAILED" variant="danger" size="sm" />
                      )}
                      {ord.status === OrderStatus.UNKNOWN_BROKER_STATE && (
                        <Badge label="UNKNOWN TIMEOUT" variant="danger" size="sm" />
                      )}
                      {ord.status === OrderStatus.REJECTED && (
                        <Badge label="REJECTED" variant="danger" size="sm" />
                      )}
                      {ord.status === OrderStatus.CLOSED && (
                        <Badge label="CLOSED" variant="neutral" size="sm" />
                      )}
                    </td>
                    <td style={{ padding: spacing.sm, color: ord.rejectionReason ? colors.loss : colors.textMuted, fontSize: '11px' }}>
                      {ord.status === OrderStatus.ACKNOWLEDGED && 'Awaiting confirmed fill — request accepted'}
                      {ord.status === OrderStatus.PROTECTED && 'GTT limit stops attached to confirmed fill'}
                      {ord.rejectionReason ? ord.rejectionReason : ord.status !== OrderStatus.ACKNOWLEDGED && ord.status !== OrderStatus.PROTECTED && `Avg Fill: ₹${ord.averageFillPrice.toFixed(2)}`}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'JOURNAL' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              padding: spacing.md,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.md,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
              <div>
                <h3 style={{ margin: 0, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold }}>
                  Statutory Charge Accounting & Performance Audit
                </h3>
                <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
                  Proposals and simulated fills estimate charges using configured rates. Actual live charges require verified broker accounting.
                </p>
              </div>

              <button
                onClick={handleExportCsv}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  backgroundColor: colors.cyan,
                  color: '#082F49',
                  border: 'none',
                  borderRadius: borderRadius.sm,
                  fontWeight: typography.fontWeight.bold,
                  cursor: 'pointer',
                  fontSize: typography.fontSize.xs,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                📥 Download Daily Audit CSV (RFC-4180)
              </button>
            </div>

            {/* Fee Variance Savings Summary Strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: spacing.sm,
              }}
            >
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.sm, borderRadius: borderRadius.sm }}>
                <div style={{ fontSize: '11px', color: colors.textMuted }}>ESTIMATED FEES</div>
                <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.warning, marginTop: 2 }}>
                  ₹{fills.reduce((sum, f) => sum + f.estimatedCharges, 0).toFixed(2)}
                </div>
              </div>
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.sm, borderRadius: borderRadius.sm }}>
                <div style={{ fontSize: '11px', color: colors.textMuted }}>ACTUAL STATUTORY LEVIES</div>
                <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.textPrimary, marginTop: 2 }}>
                  ₹{fills.reduce((sum, f) => sum + f.actualCharges, 0).toFixed(2)}
                </div>
              </div>
              <div style={{ backgroundColor: colors.surfaceElevated, padding: spacing.sm, borderRadius: borderRadius.sm }}>
                <div style={{ fontSize: '11px', color: colors.textMuted }}>FEE VARIANCE SAVINGS</div>
                <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold, color: colors.profit, marginTop: 2 }}>
                  +₹{(fills.reduce((sum, f) => sum + f.estimatedCharges, 0) - fills.reduce((sum, f) => sum + f.actualCharges, 0)).toFixed(2)} saved
                </div>
              </div>
            </div>
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
                {fills.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: spacing.xl, textAlign: 'center', color: colors.textMuted }}>
                      No confirmed trade fills recorded. Charge estimates and verified broker charges appear with the ledger.
                    </td>
                  </tr>
                ) : (
                  fills.map((f) => {
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
                }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'CHECKLIST' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {/* Header Banner */}
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              padding: spacing.md,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: spacing.md,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                <h3 style={{ margin: 0, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.bold }}>
                  10-Point Pre-Flight Go-Live Safety Checklist
                </h3>
                {checklistItems.every((i) => i.passed) && checklistSignedOffAt ? (
                  <Badge label="LIVE EXECUTION: PERMITTED" variant="success" />
                ) : (
                  <Badge label="LIVE EXECUTION: BLOCKED" variant="danger" />
                )}
              </div>
              <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: typography.fontSize.xs }}>
                Mandatory Section 20 Blueprint Acceptance: All 10 regulatory, infrastructure, risk, and consent gates must be verified before live order submission.
              </p>
              {checklistSignedOffAt && (
                <div style={{ fontSize: '11px', color: colors.profit, marginTop: 4 }}>
                  Signed off by {checklistSignedOffBy} at {new Date(checklistSignedOffAt).toLocaleTimeString()} IST.
                </div>
              )}
            </div>

            <button
              onClick={handleCompleteChecklist}
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                backgroundColor: colors.profit,
                color: '#022C22',
                border: 'none',
                borderRadius: borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.bold,
                cursor: 'pointer',
              }}
            >
              Sign Off Checklist as Platform Owner
            </button>
          </div>

          {/* Checklist Items Table */}
          <div style={{ backgroundColor: colors.surface, borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: typography.fontSize.xs }}>
              <thead>
                <tr style={{ backgroundColor: colors.surfaceElevated, borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}>
                  <th style={{ padding: spacing.sm }}>GATE CATEGORY</th>
                  <th style={{ padding: spacing.sm }}>CHECKLIST ITEM & DESCRIPTION</th>
                  <th style={{ padding: spacing.sm }}>AUDIT EVIDENCE</th>
                  <th style={{ padding: spacing.sm }}>STATUS</th>
                  <th style={{ padding: spacing.sm }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {checklistItems.map((item) => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: spacing.sm }}>
                      <Badge
                        label={item.category}
                        variant={
                          item.category === 'RISK_CAPS' || item.category === 'PROTECTION_MECHANISM'
                            ? 'primary'
                            : item.category === 'REGULATORY' || item.category === 'CONSENT'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                      />
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      <div style={{ fontWeight: typography.fontWeight.bold, color: colors.textPrimary }}>
                        {item.title}
                      </div>
                      <div style={{ color: colors.textSecondary, fontSize: '11px', marginTop: 2 }}>
                        {item.description}
                      </div>
                    </td>
                    <td style={{ padding: spacing.sm, color: colors.textMuted, fontSize: '11px' }}>
                      {item.evidence || 'Verification recorded in system audit log.'}
                      {item.verifiedAt && (
                        <div style={{ color: colors.cyan, fontSize: '10px', marginTop: 2 }}>
                          Verified: {new Date(item.verifiedAt).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      {item.passed ? (
                        <Badge label="VERIFIED PASSED" variant="success" size="sm" />
                      ) : (
                        <Badge label="PENDING ACTION" variant="danger" size="sm" />
                      )}
                    </td>
                    <td style={{ padding: spacing.sm }}>
                      {!item.passed ? (
                        <button
                          onClick={() => handleSignOffItem(item.id)}
                          style={{
                            padding: '3px 8px',
                            backgroundColor: colors.surfaceElevated,
                            color: colors.cyan,
                            border: `1px solid ${colors.cyan}`,
                            borderRadius: borderRadius.sm,
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Verify & Pass
                        </button>
                      ) : (
                        <span style={{ color: colors.profit, fontSize: '11px' }}>✓ Compliant</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
