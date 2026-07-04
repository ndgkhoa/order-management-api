/**
 * Order status — the single home for both the vocabulary AND the legal transitions.
 * Values (`ORDER_STATUSES`, `OrderStatus`, `OrderStatuses`) drive the Drizzle column default and
 * every typed reference; the state machine (`TRANSITIONS` / `canTransition` / `assertTransition`)
 * guards moves. Terminal states (`cancelled`, `delivered`) accept no further transitions — in
 * particular `cancelled → paid` is rejected so a late PaymentSucceeded can never revive a
 * cancelled order. Reference statuses as `OrderStatuses.Paid`, never a bare string; route every
 * status change through `assertTransition` (the `transitionOrder` helper does this for you).
 */
export const ORDER_STATUSES = ['pending', 'paid', 'fulfilling', 'delivered', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const OrderStatuses = {
  Pending: 'pending',
  Paid: 'paid',
  Fulfilling: 'fulfilling',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
} as const satisfies Record<string, OrderStatus>;

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'], // PaymentSucceeded | out_of_stock / pre-pay cancel
  paid: ['fulfilling', 'cancelled'], // shipment advancing | pre-ship cancel (refund)
  fulfilling: ['delivered'],
  delivered: [], // terminal
  cancelled: [], // terminal
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws on an illegal transition. Callers should hold a row lock / use compare-and-set. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal order status transition: ${from} → ${to}`);
  }
}
