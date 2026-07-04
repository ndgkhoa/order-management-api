import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition } from '@/utils/state-machine.js';
import { ORDER_TRANSITIONS } from '@/types/order-status.js';

describe('order status machine', () => {
  it('allows the legal transitions', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'pending', 'paid')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'pending', 'cancelled')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'paid', 'fulfilling')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'paid', 'cancelled')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'fulfilling', 'delivered')).toBe(true);
  });

  it('rejects illegal + terminal transitions', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'cancelled', 'paid')).toBe(false); // no reviving
    expect(canTransition(ORDER_TRANSITIONS, 'delivered', 'cancelled')).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, 'pending', 'delivered')).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, 'paid', 'pending')).toBe(false);
  });

  it('assertTransition throws on an illegal move', () => {
    expect(() => assertTransition(ORDER_TRANSITIONS, 'cancelled', 'paid')).toThrowError(
      /illegal status/,
    );
    expect(() => assertTransition(ORDER_TRANSITIONS, 'pending', 'cancelled')).not.toThrow();
  });
});
