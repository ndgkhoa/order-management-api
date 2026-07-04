/** RabbitMQ topology + event names shared by the outbox relay and the worker. */
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

/** A single snapshotted line of an order, carried in the OrderCreated event. */
export interface OrderCreatedItem {
  productId: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
}

/** Payload stored in the outbox row and delivered to the worker. */
export interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  items: OrderCreatedItem[];
  totalCents: number;
}

/** A reserved line — pinned to `{ productId, quantity }` so the payment step (phase 6)
 *  can commit/release the reservation without re-querying the order. */
export interface ReservedItem {
  productId: string;
  quantity: number;
}

/** Emitted after stock is reserved for every line of an order. */
export interface InventoryReservedPayload {
  orderId: string;
  items: ReservedItem[];
}

/** Emitted when an order is cancelled by a saga step (e.g. insufficient stock). */
export interface OrderCancelledPayload {
  orderId: string;
  reason: string;
}

/** Emitted after a pending payment row is created for a reserved order. */
export interface PaymentCreatedPayload {
  orderId: string;
  paymentId: string;
  amountCents: number;
}

/** Emitted by the webhook when the provider reports a payment outcome. Carries `orderId`
 *  so the completion/compensation consumers act on the order without a payment lookup. */
export interface PaymentSettledPayload {
  orderId: string;
  paymentId: string;
}

/** Emitted after an order is marked paid and its reservation committed. */
export interface OrderPaidPayload {
  orderId: string;
  paymentId: string;
}

/** Shipment lifecycle events (created + each advance). `status` is the new shipment status. */
export interface ShipmentEventPayload {
  orderId: string;
  shipmentId: string;
  status: string;
}

/** Emitted when a paid order is cancelled pre-ship and refunded (mock) + restocked. */
export interface OrderRefundedPayload {
  orderId: string;
  paymentId: string;
}
