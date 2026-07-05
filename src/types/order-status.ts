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
  pending: ['paid', 'cancelled'],
  paid: ['fulfilling', 'cancelled'],
  fulfilling: ['delivered'],
  delivered: [],
  cancelled: [],
};
