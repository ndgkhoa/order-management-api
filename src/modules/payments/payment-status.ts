/**
 * Canonical payment status machine — the single source of truth for legal transitions.
 * `failed` and `refunded` are terminal; in particular `failed → paid` is rejected so a late
 * SUCCEEDED webhook (distinct provider event id → past the dedup) can never revive a payment
 * the provider already failed. Callers apply transitions with a compare-and-set UPDATE.
 * Status values and types live in `@/types/payment-status.ts`; import them from there.
 */
import { type PaymentStatus } from '@/types/payment-status.js';

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  failed: [], // terminal
  refunded: [], // terminal
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws on an illegal transition. Callers should use compare-and-set on the row. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal payment status transition: ${from} → ${to}`);
  }
}
