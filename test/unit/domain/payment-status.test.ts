import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition } from '@/utils/state-machine.js';
import { PAYMENT_TRANSITIONS } from '@/types/payment-status.js';

describe('payment status machine', () => {
  it('allows pending → paid and pending → failed', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'pending', 'paid')).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, 'pending', 'failed')).toBe(true);
  });

  it('allows paid → refunded', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'paid', 'refunded')).toBe(true);
  });

  it('rejects reviving a terminal payment (failed → paid, paid → failed)', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'failed', 'paid')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'paid', 'failed')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'refunded', 'paid')).toBe(false);
  });

  it('assertTransition throws on an illegal transition', () => {
    expect(() => assertTransition(PAYMENT_TRANSITIONS, 'failed', 'paid')).toThrow();
    expect(() => assertTransition(PAYMENT_TRANSITIONS, 'pending', 'paid')).not.toThrow();
  });
});
