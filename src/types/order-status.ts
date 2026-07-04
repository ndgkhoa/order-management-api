/**
 * Order status vocabulary + legal-transition map. Values (`ORDER_STATUSES`, `OrderStatus`,
 * `OrderStatuses`) drive the Drizzle column default and every typed reference; `ORDER_TRANSITIONS`
 * is the state machine, evaluated by the generic guards in `@/utils/state-machine`. Terminal states
 * (`cancelled`, `delivered`) accept no further transitions — in particular `cancelled → paid` is
 * rejected so a late PaymentSucceeded can never revive a cancelled order. Reference statuses as
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

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'], // PaymentSucceeded | out_of_stock / pre-pay cancel
  paid: ['fulfilling', 'cancelled'], // shipment advancing | pre-ship cancel (refund)
  fulfilling: ['delivered'],
  delivered: [], // terminal
  cancelled: [], // terminal
};
