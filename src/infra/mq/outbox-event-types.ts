/** RabbitMQ topology + event names shared by the outbox relay and the worker. */
export const ORDER_EVENTS_EXCHANGE = 'order.events';
export const ORDER_CREATED_EVENT = 'order.created';
export const INVENTORY_RESERVED_EVENT = 'inventory.reserved';
export const ORDER_CANCELLED_EVENT = 'order.cancelled';

/** A single snapshotted line of an order, carried in the OrderCreated event. */
export interface OrderCreatedItem {
  productId: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
}

/** Payload stored in the outbox row and delivered to the worker.
 *  Includes the recipient email so the worker needs no extra DB query. */
export interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  email: string;
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
