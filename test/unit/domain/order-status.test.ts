import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition } from '@/domain/order-status.js';

describe('order status machine', () => {
  it('allows the legal transitions', () => {
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('paid', 'fulfilling')).toBe(true);
    expect(canTransition('paid', 'cancelled')).toBe(true);
    expect(canTransition('fulfilling', 'delivered')).toBe(true);
  });

  it('rejects illegal + terminal transitions', () => {
    expect(canTransition('cancelled', 'paid')).toBe(false); // no reviving a cancelled order
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('paid', 'pending')).toBe(false);
  });

  it('assertTransition throws on an illegal move', () => {
    expect(() => assertTransition('cancelled', 'paid')).toThrowError(/illegal order status/);
    expect(() => assertTransition('pending', 'cancelled')).not.toThrow();
  });
});
