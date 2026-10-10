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
