import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@trading-bot/contracts';
import {
  canTransitionOrder,
  transitionOrderState,
  isTerminalOrderState,
  InvalidOrderStateTransitionError,
} from '../order-state-machine';

describe('Order State Machine (Section 8 Blueprint)', () => {
  it('allows standard happy path transition sequence', () => {
    let state = OrderStatus.PROPOSED;

    state = transitionOrderState(state, OrderStatus.RISK_APPROVED);
    expect(state).toBe(OrderStatus.RISK_APPROVED);

    state = transitionOrderState(state, OrderStatus.USER_APPROVED);
    expect(state).toBe(OrderStatus.USER_APPROVED);

    state = transitionOrderState(state, OrderStatus.SUBMITTING);
    expect(state).toBe(OrderStatus.SUBMITTING);

    state = transitionOrderState(state, OrderStatus.ACKNOWLEDGED);
    expect(state).toBe(OrderStatus.ACKNOWLEDGED);

    state = transitionOrderState(state, OrderStatus.FILLED);
    expect(state).toBe(OrderStatus.FILLED);

    state = transitionOrderState(state, OrderStatus.PROTECTED);
    expect(state).toBe(OrderStatus.PROTECTED);

    state = transitionOrderState(state, OrderStatus.CLOSING);
    expect(state).toBe(OrderStatus.CLOSING);

    state = transitionOrderState(state, OrderStatus.CLOSED);
    expect(state).toBe(OrderStatus.CLOSED);

    expect(isTerminalOrderState(state)).toBe(true);
  });

  it('supports partial fills transition cycle', () => {
    let state = OrderStatus.ACKNOWLEDGED;

    state = transitionOrderState(state, OrderStatus.PARTIALLY_FILLED);
    expect(state).toBe(OrderStatus.PARTIALLY_FILLED);

    // Another partial fill
    state = transitionOrderState(state, OrderStatus.PARTIALLY_FILLED);
    expect(state).toBe(OrderStatus.PARTIALLY_FILLED);

    // Completed
    state = transitionOrderState(state, OrderStatus.FILLED);
    expect(state).toBe(OrderStatus.FILLED);
  });

  it('rejects illegal transitions (skipping states or modifying terminal states)', () => {
    // Cannot jump from PROPOSED straight to FILLED
    expect(canTransitionOrder(OrderStatus.PROPOSED, OrderStatus.FILLED)).toBe(false);
    expect(() =>
      transitionOrderState(OrderStatus.PROPOSED, OrderStatus.FILLED),
    ).toThrow(InvalidOrderStateTransitionError);

    // Cannot transition out of terminal CLOSED
    expect(canTransitionOrder(OrderStatus.CLOSED, OrderStatus.SUBMITTING)).toBe(false);
    expect(() =>
      transitionOrderState(OrderStatus.CLOSED, OrderStatus.SUBMITTING),
    ).toThrow(InvalidOrderStateTransitionError);

    // Cannot transition out of terminal REJECTED
    expect(canTransitionOrder(OrderStatus.REJECTED, OrderStatus.FILLED)).toBe(false);
    expect(() =>
      transitionOrderState(OrderStatus.REJECTED, OrderStatus.FILLED),
    ).toThrow(InvalidOrderStateTransitionError);
  });
});
