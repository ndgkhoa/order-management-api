/**
 * Order status values — single source of truth. Lives in src/types so the DB layer and the
 * app layer both depend on it without coupling to each other. `ORDER_STATUSES` drives the
 * Drizzle column default, the `OrderStatus` union, and the named `OrderStatuses` constants.
 * The status-machine logic (TRANSITIONS map, `canTransition`, `assertTransition`) lives in
 * src/modules/orders/order-status.ts and imports from here. Reference statuses as
 * `OrderStatuses.Paid`, never a bare string.
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
