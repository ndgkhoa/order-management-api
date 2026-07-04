import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition } from '@/domain/payment-status.js';

describe('payment status machine', () => {
  it('allows pending → paid and pending → failed', () => {
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);
  });

  it('allows paid → refunded', () => {
    expect(canTransition('paid', 'refunded')).toBe(true);
  });

  it('rejects reviving a terminal payment (failed → paid, paid → failed)', () => {
    expect(canTransition('failed', 'paid')).toBe(false);
    expect(canTransition('paid', 'failed')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
  });

  it('assertTransition throws on an illegal transition', () => {
    expect(() => assertTransition('failed', 'paid')).toThrow();
    expect(() => assertTransition('pending', 'paid')).not.toThrow();
  });
});
