import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@trading-bot/contracts';
import {
  canTransitionOrder,
  transitionOrderState,
  isTerminalOrderState,
  InvalidOrderStateTransitionError,
  assertAckNotLabeledAsFilled,
  isOrderInFlight,
  validateGTTExitParameters,
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

  describe('Phase 5 Supervised Invariants & GTT Protective Rules', () => {
    it('INVARIANT: ACK is never labeled or treated as FILLED', () => {
      expect(() => {
        assertAckNotLabeledAsFilled(OrderStatus.ACKNOWLEDGED);
      }).toThrow(/invariant violation: broker acknowledged status cannot be treated or displayed as filled/i);
    });

    it('identifies in-flight orders waiting for broker execution', () => {
      expect(isOrderInFlight(OrderStatus.ACKNOWLEDGED)).toBe(true);
      expect(isOrderInFlight(OrderStatus.SUBMITTING)).toBe(true);
      expect(isOrderInFlight(OrderStatus.PARTIALLY_FILLED)).toBe(true);
      expect(isOrderInFlight(OrderStatus.FILLED)).toBe(false);
      expect(isOrderInFlight(OrderStatus.CLOSED)).toBe(false);
    });

    it('validates GTT multi-leg protective parameters against hard risk caps', () => {
      // Valid: fill 122.5, stop 114, target 136, qty 25 -> risk: (122.5 - 114) * 25 + 58.2 = 270.7 <= 500
      const validRes = validateGTTExitParameters({
        fillPrice: 122.5,
        stopLossPrice: 114.0,
        targetPrice: 136.0,
        quantity: 25,
      });
      expect(validRes.isValid).toBe(true);
      expect(validRes.allInRiskInr).toBe(270.7);

      // Invalid: stop loss price >= fill price
      const invalidStop = validateGTTExitParameters({
        fillPrice: 122.5,
        stopLossPrice: 125.0,
        targetPrice: 136.0,
        quantity: 25,
      });
      expect(invalidStop.isValid).toBe(false);
      expect(invalidStop.error).toContain('Stop loss price');

      // Invalid: target price <= fill price
      const invalidTarget = validateGTTExitParameters({
        fillPrice: 122.5,
        stopLossPrice: 114.0,
        targetPrice: 120.0,
        quantity: 25,
      });
      expect(invalidTarget.isValid).toBe(false);
      expect(invalidTarget.error).toContain('Profit target price');

      // Invalid: all-in risk exceeds ₹500 cap
      const excessiveRisk = validateGTTExitParameters({
        fillPrice: 140.0,
        stopLossPrice: 115.0, // Risk: 25 * 25 + 58.2 = 683.2 > 500
        targetPrice: 160.0,
        quantity: 25,
      });
      expect(excessiveRisk.isValid).toBe(false);
      expect(excessiveRisk.error).toContain('exceeds hard cap of ₹500.00');
    });
  });
});
