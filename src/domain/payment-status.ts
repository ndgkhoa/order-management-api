/**
 * Payment status — the single home for both the vocabulary AND the legal transitions.
 * Values (`PAYMENT_STATUSES`, `PaymentStatus`, `PaymentStatuses`) drive the Drizzle column default
 * and every typed reference; the state machine (`TRANSITIONS` / `canTransition` / `assertTransition`)
 * guards moves. `failed` and `refunded` are terminal — in particular `failed → paid` is rejected so
 * a late SUCCEEDED webhook (distinct provider event id → past the dedup) can never revive a payment
 * the provider already failed. Reference statuses as `PaymentStatuses.Paid`, never a bare string.
 */
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PaymentStatuses = {
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
} as const satisfies Record<string, PaymentStatus>;

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
