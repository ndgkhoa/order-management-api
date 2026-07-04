/**
 * Payment status vocabulary + legal-transition map. Values (`PAYMENT_STATUSES`, `PaymentStatus`,
 * `PaymentStatuses`) drive the Drizzle column default and every typed reference;
 * `PAYMENT_TRANSITIONS` is the state machine, evaluated by the generic guards in
 * `@/utils/state-machine`. `failed` and `refunded` are terminal — in particular `failed → paid` is
 * rejected so a late SUCCEEDED webhook (distinct provider event id → past the dedup) can never
 * revive a payment the provider already failed. Reference statuses as `PaymentStatuses.Paid`.
 */
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PaymentStatuses = {
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
} as const satisfies Record<string, PaymentStatus>;

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  failed: [], // terminal
  refunded: [], // terminal
};
