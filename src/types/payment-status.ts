/**
 * Payment status values — single source of truth. Lives in src/types so the DB layer and the
 * app layer both depend on it without coupling to each other. `PAYMENT_STATUSES` drives the
 * Drizzle column default, the `PaymentStatus` union, and the named `PaymentStatuses` constants.
 * The status-machine logic (TRANSITIONS map, `canTransition`, `assertTransition`) lives in
 * src/modules/payments/payment-status.ts and imports from here. Reference statuses as
 * `PaymentStatuses.Paid`, never a bare string.
 */
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PaymentStatuses = {
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
} as const satisfies Record<string, PaymentStatus>;
