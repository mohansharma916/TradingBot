import { Injectable, Inject, Logger } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { EventsGateway } from '../websocket/events.gateway';

export class RiskGateViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskGateViolationError';
  }
}

export class DuplicateIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateIntentError';
  }
}

export interface ReservationRequest {
  proposalId: string;
  signalKey: string;
  instrumentKey: string;
  capitalRequired: number;
  allInRisk: number;
  maxCapitalCap?: number;
  maxTradeRiskCap?: number;
  maxDailyRiskCap?: number;
}

export interface ReservationRecord {
  id: string;
  proposalId: string;
  signalKey: string;
  instrumentKey: string;
  reservedCapital: number;
  reservedRisk: number;
  status: 'HELD' | 'COMMITTED' | 'RELEASED';
  createdAt: string;
}

/**
 * RiskReservationManager
 * Central server-side exposure and capital ledger with concurrency protection.
 * Strict Invariants:
 * 1. Zero Double-Spending: Available cash and risk budget are debited before order dispatch.
 * 2. Single Unresolved Intent: Duplicate signal keys on the same bar are blocked.
 * 3. Daily Drawdown Guard: Rejects trades if all-in risk exceeds remaining daily drawdown cap.
 */
@Injectable()
export class RiskReservationManager {
  private readonly logger = new Logger(RiskReservationManager.name);

  private readonly totalAccountCapital: number;
  private readonly dailyDrawdownCap: number;
  private readonly maxTradeRiskCap: number;
  private readonly maxOpenPositions = 1;

  private availableCash: number;
  private realizedNetDailyLoss = 0; // Accumulated losses today (positive value)
  private realizedNetDailyGain = 0; // Accumulated gains today

  private reservations: Map<string, ReservationRecord> = new Map();
  private activeSignalKeys: Set<string> = new Set();
  private openPositionsCount = 0;
  private killSwitchActive = false;
  private ledgerTradingDate = this.currentTradingDate();

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {
    this.totalAccountCapital = this.envService.config.MAX_ACCOUNT_CAPITAL_INR || 10000;
    this.dailyDrawdownCap = this.envService.config.MAX_DAILY_DRAWDOWN_INR || 1500;
    this.maxTradeRiskCap = this.envService.config.MAX_ALL_IN_TRADE_RISK_INR || 500;
    this.availableCash = this.totalAccountCapital;
  }

  /**
   * Evaluates policy and acquires an atomic capital & risk reservation.
   * Throws RiskGateViolationError or DuplicateIntentError if safety limits violated.
   */
  public acquireReservation(request: ReservationRequest): ReservationRecord {
    this.ensureTradingDay();
    if (![request.capitalRequired, request.allInRisk].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RiskGateViolationError('Capital and all-in risk must be positive finite amounts.');
    }
    if (this.killSwitchActive) {
      throw new RiskGateViolationError('Kill switch is ACTIVE: All new trades and reservations are blocked.');
    }

    // 1. Check unique signal intent (prevents replay or concurrent agent duplicate recommendations)
    if (this.activeSignalKeys.has(request.signalKey)) {
      throw new DuplicateIntentError(
        `DUPLICATE_INTENT: An active trade intent already exists for signal key '${request.signalKey}'.`,
      );
    }

    // 2. Validate against account hard capital limits
    const maxTradeRisk = Math.min(request.maxTradeRiskCap ?? this.maxTradeRiskCap, this.maxTradeRiskCap);
    if (request.allInRisk > maxTradeRisk) {
      throw new RiskGateViolationError(
        `All-in risk ₹${request.allInRisk.toFixed(2)} exceeds maximum per-trade limit ₹${maxTradeRisk.toFixed(2)}.`,
      );
    }

    if (request.capitalRequired > Math.min(request.maxCapitalCap ?? this.totalAccountCapital, this.totalAccountCapital)) {
      throw new RiskGateViolationError(
        `Required capital ₹${request.capitalRequired.toFixed(2)} exceeds total account budget ₹${this.totalAccountCapital}.`,
      );
    }

    // 3. Check Available Cash (prevents concurrent double-spending)
    if (request.capitalRequired > this.availableCash) {
      throw new RiskGateViolationError(
        `CAPITAL_EXHAUSTION: Required capital ₹${request.capitalRequired.toFixed(2)} exceeds available cash ₹${this.availableCash.toFixed(2)}.`,
      );
    }

    // 4. Check Remaining Daily Risk Budget
    const totalReservedRisk = this.getTotalReservedRisk();
    const remainingDailyRiskBudget = Math.max(
      0,
      Math.min(request.maxDailyRiskCap ?? this.dailyDrawdownCap, this.dailyDrawdownCap) - this.realizedNetDailyLoss - totalReservedRisk,
    );

    if (request.allInRisk > remainingDailyRiskBudget) {
      throw new RiskGateViolationError(
        `DRAWDOWN_LIMIT: All-in risk ₹${request.allInRisk.toFixed(2)} exceeds remaining daily risk budget ₹${remainingDailyRiskBudget.toFixed(2)} (Cap: ₹${this.dailyDrawdownCap}).`,
      );
    }

    // 5. Check Max Open Positions Limit
    const heldCount = this.getHeldReservationsCount();
    if (this.openPositionsCount + heldCount >= this.maxOpenPositions) {
      throw new RiskGateViolationError(
        `POSITION_LIMIT: Maximum open positions reached (${this.openPositionsCount + heldCount}/${this.maxOpenPositions}).`,
      );
    }

    // All gates pass: Atomically debit cash & register reservation
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const record: ReservationRecord = {
      id: reservationId,
      proposalId: request.proposalId,
      signalKey: request.signalKey,
      instrumentKey: request.instrumentKey,
      reservedCapital: request.capitalRequired,
      reservedRisk: request.allInRisk,
      status: 'HELD',
      createdAt: new Date().toISOString(),
    };

    this.availableCash = Number((this.availableCash - request.capitalRequired).toFixed(2));
    this.reservations.set(reservationId, record);
    this.activeSignalKeys.add(request.signalKey);

    this.logger.log(
      `[RiskReservationManager] Reservation ${reservationId} ACQUIRED: Capital ₹${request.capitalRequired}, Risk ₹${request.allInRisk}. Remaining Cash: ₹${this.availableCash}.`,
    );

    this.gateway.broadcast('risk.reserved', {
      reservationId,
      availableCash: this.availableCash,
      remainingRiskBudget: remainingDailyRiskBudget - request.allInRisk,
    });

    return record;
  }

  /**
   * Releases an unexecuted or cancelled reservation back into available cash.
   */
  public releaseReservation(reservationId: string, reason = 'Order cancelled/rejected'): void {
    const record = this.reservations.get(reservationId);
    if (!record || record.status !== 'HELD') {
      return;
    }

    record.status = 'RELEASED';
    this.availableCash = Number((this.availableCash + record.reservedCapital).toFixed(2));
    this.activeSignalKeys.delete(record.signalKey);
    this.reservations.set(reservationId, record);

    this.logger.log(
      `[RiskReservationManager] Reservation ${reservationId} RELEASED (${reason}). Restored ₹${record.reservedCapital} to cash. Available Cash: ₹${this.availableCash}.`,
    );

    this.gateway.broadcast('risk.released', {
      reservationId,
      availableCash: this.availableCash,
    });
  }

  /**
   * Commits a held reservation when an order fill confirms, converting it into an open position.
   */
  public commitReservationToPosition(reservationId: string, actualFilledCapital: number): void {
    const record = this.reservations.get(reservationId);
    if (!record || record.status !== 'HELD') return;
    if (!Number.isFinite(actualFilledCapital) || actualFilledCapital <= 0 || actualFilledCapital > record.reservedCapital) {
      throw new RiskGateViolationError('Confirmed filled capital must be positive and within its reservation.');
    }

    record.status = 'COMMITTED';
    this.openPositionsCount++;

    // Adjust any difference between reserved capital and actual filled capital
    const diff = record.reservedCapital - actualFilledCapital;
    if (diff > 0) {
      this.availableCash = Number((this.availableCash + diff).toFixed(2));
    }
    record.reservedCapital = actualFilledCapital;

    this.reservations.set(reservationId, record);
    this.logger.log(
      `[RiskReservationManager] Reservation ${reservationId} COMMITTED to open position. Active positions: ${this.openPositionsCount}.`,
    );
  }

  /**
   * Settles a closed position: credits net P&L and updates daily loss/gain ledger.
   */
  public settleClosedPosition(
    signalKey: string,
    initialCapital: number,
    realizedNetPnl: number,
  ): void {
    if (this.openPositionsCount > 0) {
      this.openPositionsCount--;
    }
    this.activeSignalKeys.delete(signalKey);

    // Mark matching reservation as RELEASED
    for (const [id, record] of this.reservations.entries()) {
      if (record.signalKey === signalKey && (record.status === 'HELD' || record.status === 'COMMITTED')) {
        record.status = 'RELEASED';
        this.reservations.set(id, record);
      }
    }

    // Return principal + net P&L to cash
    this.availableCash = Number((this.availableCash + initialCapital + realizedNetPnl).toFixed(2));

    if (realizedNetPnl < 0) {
      this.realizedNetDailyLoss += Math.abs(realizedNetPnl);
    } else {
      this.realizedNetDailyGain += realizedNetPnl;
    }

    this.logger.log(
      `[RiskReservationManager] Position closed for ${signalKey}. Net P&L: ₹${realizedNetPnl}. Available Cash: ₹${this.availableCash}. Total Daily Loss: ₹${this.realizedNetDailyLoss}.`,
    );

    this.gateway.broadcast('risk.settled', {
      availableCash: this.availableCash,
      realizedNetDailyPnl: this.realizedNetDailyGain - this.realizedNetDailyLoss,
    });
  }

  /** Reconcile an owned fill exactly once; rejected exits never release its capital. */
  public settleReservation(reservationId: string, realizedNetPnl: number): boolean {
    const record = this.reservations.get(reservationId);
    if (!record || record.status !== 'COMMITTED' || !Number.isFinite(realizedNetPnl)) return false;
    this.settleClosedPosition(record.signalKey, record.reservedCapital, realizedNetPnl);
    return true;
  }

  public getReservation(reservationId: string): ReservationRecord | undefined {
    const record = this.reservations.get(reservationId);
    return record ? { ...record } : undefined;
  }

  public getOpenPositionsCount(): number {
    return this.openPositionsCount;
  }

  public getRealizedNetDailyPnl(): number {
    return Number((this.realizedNetDailyGain - this.realizedNetDailyLoss).toFixed(2));
  }

  public getRealizedDailyLoss(): number {
    return this.realizedNetDailyLoss;
  }

  public getAvailableCash(): number {
    this.ensureTradingDay();
    return this.availableCash;
  }

  /** Restore confirmed daily results on startup, before any new reservation can be accepted. */
  public restoreDailyResults(tradingDate: string, results: { orderId: string; realizedNetPnl: number }[]): void {
    if (tradingDate !== this.currentTradingDate()) return;
    if (this.openPositionsCount > 0 || this.getHeldReservationsCount() > 0) throw new RiskGateViolationError('Cannot restore a daily ledger while exposure is active.');
    const unique = new Map(results.map((result) => [result.orderId, result.realizedNetPnl]));
    if (Array.from(unique.values()).some((value) => !Number.isFinite(value))) throw new RiskGateViolationError('Confirmed daily results must be finite.');
    this.realizedNetDailyLoss = Array.from(unique.values()).reduce((total, pnl) => total + Math.max(0, -pnl), 0);
    this.realizedNetDailyGain = Array.from(unique.values()).reduce((total, pnl) => total + Math.max(0, pnl), 0);
    this.availableCash = Number((this.totalAccountCapital + this.realizedNetDailyGain - this.realizedNetDailyLoss).toFixed(2));
    this.ledgerTradingDate = tradingDate;
  }

  public restoreConfirmedPosition(record: ReservationRecord): void {
    if (this.reservations.has(record.id)) throw new RiskGateViolationError('A recovered reservation ID is already present.');
    if (this.openPositionsCount !== 0 || this.getHeldReservationsCount() !== 0 || this.activeSignalKeys.has(record.signalKey)) throw new RiskGateViolationError('Recovered exposure conflicts with an existing position or intent.');
    if (!Number.isFinite(record.reservedCapital) || record.reservedCapital <= 0 || record.reservedCapital > this.availableCash || record.reservedCapital > this.totalAccountCapital || !Number.isFinite(record.reservedRisk) || record.reservedRisk <= 0 || record.reservedRisk > this.maxTradeRiskCap) throw new RiskGateViolationError('Recovered position has invalid or excessive confirmed capital/risk.');
    this.reservations.set(record.id, { ...record, status: 'COMMITTED' });
    this.activeSignalKeys.add(record.signalKey);
    this.availableCash = Number((this.availableCash - record.reservedCapital).toFixed(2));
    this.openPositionsCount = 1;
    this.gateway.broadcast('risk.restored', { reservationId: record.id, availableCash: this.availableCash });
  }

  public getTotalReservedCapital(): number {
    let total = 0;
    for (const record of this.reservations.values()) {
      if (record.status === 'HELD' || record.status === 'COMMITTED') {
        total += record.reservedCapital;
      }
    }
    return Number(total.toFixed(2));
  }

  public getTotalReservedRisk(): number {
    let total = 0;
    for (const record of this.reservations.values()) {
      if (record.status === 'HELD' || record.status === 'COMMITTED') {
        total += record.reservedRisk;
      }
    }
    return Number(total.toFixed(2));
  }

  public getHeldReservationsCount(): number {
    let count = 0;
    for (const record of this.reservations.values()) {
      if (record.status === 'HELD') count++;
    }
    return count;
  }

  public getHeldReservations(): ReservationRecord[] {
    return Array.from(this.reservations.values()).filter((r) => r.status === 'HELD');
  }

  public getActiveReservations(): ReservationRecord[] {
    return Array.from(this.reservations.values()).filter((record) => record.status !== 'RELEASED').map((record) => ({ ...record }));
  }

  public getRemainingDailyRiskBudget(): number {
    this.ensureTradingDay();
    return Math.max(
      0,
      Number(
        (this.dailyDrawdownCap - this.realizedNetDailyLoss - this.getTotalReservedRisk()).toFixed(2),
      ),
    );
  }

  public setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
  }

  public isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  public resetForNewTradingDay(): void {
    if (this.openPositionsCount > 0 || this.getHeldReservationsCount() > 0) {
      throw new RiskGateViolationError('Cannot reset daily risk while positions or pending reservations remain open.');
    }
    this.realizedNetDailyLoss = 0;
    this.realizedNetDailyGain = 0;
    this.reservations.clear();
    this.activeSignalKeys.clear();
    this.openPositionsCount = 0;
    this.availableCash = this.totalAccountCapital;
    this.ledgerTradingDate = this.currentTradingDate();
  }

  private ensureTradingDay(): void {
    if (this.ledgerTradingDate !== this.currentTradingDate() && this.openPositionsCount === 0 && this.getHeldReservationsCount() === 0) this.resetForNewTradingDay();
  }

  private currentTradingDate(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}
