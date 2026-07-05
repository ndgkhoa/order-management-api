export const ORDER_EVENTS_EXCHANGE = 'order.events';
export const ORDER_CREATED_EVENT = 'order.created';
export const INVENTORY_RESERVED_EVENT = 'inventory.reserved';
export const ORDER_CANCELLED_EVENT = 'order.cancelled';
export const PAYMENT_CREATED_EVENT = 'payment.created';
export const PAYMENT_SUCCEEDED_EVENT = 'payment.succeeded';
export const PAYMENT_FAILED_EVENT = 'payment.failed';
export const ORDER_PAID_EVENT = 'order.paid';
export const SHIPMENT_CREATED_EVENT = 'shipment.created';
export const SHIPMENT_READY_EVENT = 'shipment.ready_for_pickup';
export const SHIPMENT_IN_TRANSIT_EVENT = 'shipment.in_transit';
export const SHIPMENT_DELIVERED_EVENT = 'shipment.delivered';
export const ORDER_REFUNDED_EVENT = 'order.refunded';

export interface OrderCreatedItem {
  productId: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  items: OrderCreatedItem[];
  totalCents: number;
}

export interface ReservedItem {
  productId: string;
  quantity: number;
}

export interface InventoryReservedPayload {
  orderId: string;
  items: ReservedItem[];
}

export interface OrderCancelledPayload {
  orderId: string;
  reason: string;
}

export interface PaymentCreatedPayload {
  orderId: string;
  paymentId: string;
  amountCents: number;
}

export interface PaymentSettledPayload {
  orderId: string;
  paymentId: string;
}

export interface OrderPaidPayload {
  orderId: string;
  paymentId: string;
}

export interface ShipmentEventPayload {
  orderId: string;
  shipmentId: string;
  status: string;
}

export interface OrderRefundedPayload {
  orderId: string;
  paymentId: string;
}
