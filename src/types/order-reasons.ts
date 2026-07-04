/**
 * Reason strings recorded on an order status transition (the audit `reason` in
 * order_status_history) and, when cancelling, persisted on `orders.cancel_reason`.
 * Single source of truth — reference `OrderReasons.CustomerCancelled`, never a bare string.
 */
export const OrderReasons = {
  Created: 'created',
  Refund: 'refund',
  CustomerCancelled: 'customer_cancelled',
  OutOfStock: 'out_of_stock',
  PaymentSucceeded: 'payment_succeeded',
  PaymentFailed: 'payment_failed',
  ShipmentCreated: 'shipment_created',
  ShipmentDelivered: 'shipment_delivered',
} as const;

export type OrderReason = (typeof OrderReasons)[keyof typeof OrderReasons];
