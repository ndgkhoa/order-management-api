/**
 * Canonical order status machine — the single source of truth for legal transitions.
 * Terminal states (`cancelled`, `delivered`) accept no further transitions; in particular
 * `cancelled → paid` is rejected so a late PaymentSucceeded can never revive a cancelled order.
 * Phases add their own steps but MUST route every order status change through `assertTransition`.
 * Status values and types live in `@/types/order-status.ts`; import them from there.
 */
import { type OrderStatus } from '@/types/order-status.js';

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
