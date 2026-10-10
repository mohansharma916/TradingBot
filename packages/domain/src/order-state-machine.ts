import { OrderStatus } from '@trading-bot/contracts';

/**
 * Valid state transitions mapping for trading order state machine.
 * Reference: docs/AI_FO_Trading_Platform_Blueprint.md Section 8
 */
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PROPOSED]: [
    OrderStatus.RISK_APPROVED,
    OrderStatus.REJECTED,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.RISK_APPROVED]: [
    OrderStatus.USER_APPROVED,
    OrderStatus.SUBMITTING, // For auto-eligible mode without manual prompt
    OrderStatus.REJECTED,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.USER_APPROVED]: [
    OrderStatus.SUBMITTING,
    OrderStatus.CANCELLED,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.SUBMITTING]: [
    OrderStatus.ACKNOWLEDGED,
    OrderStatus.REJECTED,
    OrderStatus.UNKNOWN_BROKER_STATE,
  ],
  [OrderStatus.ACKNOWLEDGED]: [
    OrderStatus.PARTIALLY_FILLED,
    OrderStatus.FILLED,
    OrderStatus.CANCEL_REQUESTED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED,
    OrderStatus.UNKNOWN_BROKER_STATE,
  ],
  [OrderStatus.PARTIALLY_FILLED]: [
    OrderStatus.PARTIALLY_FILLED, // Further partial fills
    OrderStatus.FILLED,
    OrderStatus.CANCEL_REQUESTED,
    OrderStatus.CANCELLED,
    OrderStatus.CLOSING,
    OrderStatus.EXIT_PROTECTION_PENDING,
  ],
  [OrderStatus.FILLED]: [
    OrderStatus.EXIT_PROTECTION_PENDING,
    OrderStatus.PROTECTED,
    OrderStatus.CLOSING,
  ],
  [OrderStatus.EXIT_PROTECTION_PENDING]: [
    OrderStatus.PROTECTED,
    OrderStatus.PROTECTION_FAILED,
    OrderStatus.MANUAL_INTERVENTION_REQUIRED,
    OrderStatus.CLOSING,
  ],
  [OrderStatus.PROTECTED]: [
    OrderStatus.CLOSING,
    OrderStatus.MANUAL_INTERVENTION_REQUIRED,
  ],
  [OrderStatus.CLOSING]: [
    OrderStatus.CLOSED,
    OrderStatus.UNKNOWN_BROKER_STATE,
    OrderStatus.MANUAL_INTERVENTION_REQUIRED,
  ],
  [OrderStatus.CANCEL_REQUESTED]: [
    OrderStatus.CANCELLED,
    OrderStatus.FILLED, // Race condition where fill arrives before cancel takes effect
    OrderStatus.UNKNOWN_BROKER_STATE,
  ],
  // Terminal States
  [OrderStatus.CLOSED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.EXPIRED]: [],
  // Exceptional States
  [OrderStatus.UNKNOWN_BROKER_STATE]: [
    OrderStatus.ACKNOWLEDGED,
    OrderStatus.FILLED,
    OrderStatus.CANCELLED,
    OrderStatus.MANUAL_INTERVENTION_REQUIRED,
  ],
  [OrderStatus.PROTECTION_FAILED]: [
    OrderStatus.CLOSING,
    OrderStatus.MANUAL_INTERVENTION_REQUIRED,
  ],
  [OrderStatus.MANUAL_INTERVENTION_REQUIRED]: [
    OrderStatus.CLOSING,
    OrderStatus.CLOSED,
    OrderStatus.CANCELLED,
  ],
};

export class InvalidOrderStateTransitionError extends Error {
  constructor(public readonly fromState: OrderStatus, public readonly toState: OrderStatus) {
    super(`Invalid order state transition from '${fromState}' to '${toState}'.`);
    this.name = 'InvalidOrderStateTransitionError';
  }
}

/**
 * Validates if a state transition is legal in the order state machine.
 */
export function canTransitionOrder(fromState: OrderStatus, toState: OrderStatus): boolean {
  const allowed = VALID_ORDER_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Asserts and performs an order state transition.
 * Throws InvalidOrderStateTransitionError if illegal.
 */
export function transitionOrderState(
  fromState: OrderStatus,
  toState: OrderStatus,
): OrderStatus {
  if (!canTransitionOrder(fromState, toState)) {
    throw new InvalidOrderStateTransitionError(fromState, toState);
  }
  return toState;
}

/**
 * Checks if a state is terminal (no further transitions possible).
 */
export function isTerminalOrderState(state: OrderStatus): boolean {
  return [
    OrderStatus.CLOSED,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED,
    OrderStatus.EXPIRED,
  ].includes(state);
}

/**
 * Invariant Guard: ACK is NEVER treated or labeled as FILLED.
 * Reference: Blueprint Phase 5 ("The UI must never label ACK as FILLED or show a guaranteed stop.")
 */
export function assertAckNotLabeledAsFilled(status: OrderStatus): void {
  if (status === OrderStatus.ACKNOWLEDGED) {
    throw new Error(
      'Invariant Violation: Broker ACKNOWLEDGED status cannot be treated or displayed as FILLED. Awaiting confirmed fill event.',
    );
  }
}

/**
 * Checks if order is active in-flight waiting for broker execution.
 */
export function isOrderInFlight(status: OrderStatus): boolean {
  return [
    OrderStatus.SUBMITTING,
    OrderStatus.ACKNOWLEDGED,
    OrderStatus.PARTIALLY_FILLED,
  ].includes(status);
}

/**
 * Validates GTT multi-leg protective parameters against hard risk caps.
 */
export function validateGTTExitParameters(params: {
  fillPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  quantity: number;
}): { isValid: boolean; allInRiskInr: number; error?: string } {
  const { fillPrice, stopLossPrice, targetPrice, quantity } = params;

  if (stopLossPrice >= fillPrice) {
    return {
      isValid: false,
      allInRiskInr: 0,
      error: `Stop loss price (₹${stopLossPrice}) must be strictly lower than entry fill price (₹${fillPrice}).`,
    };
  }

  if (targetPrice <= fillPrice) {
    return {
      isValid: false,
      allInRiskInr: 0,
      error: `Profit target price (₹${targetPrice}) must be strictly higher than entry fill price (₹${fillPrice}).`,
    };
  }

  // Pre-calculated round-trip fee estimate ₹58.20 + slippage reserve
  const allInRiskInr = Number(((fillPrice - stopLossPrice) * quantity + 58.2).toFixed(2));
  if (allInRiskInr > 500) {
    return {
      isValid: false,
      allInRiskInr,
      error: `All-in trade risk ₹${allInRiskInr} exceeds hard cap of ₹500.00.`,
    };
  }

  return { isValid: true, allInRiskInr };
}
