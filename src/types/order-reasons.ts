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
