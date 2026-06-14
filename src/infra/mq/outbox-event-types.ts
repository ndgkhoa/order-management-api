/** RabbitMQ topology + event names shared by the outbox relay and the worker. */
export const ORDER_EVENTS_EXCHANGE = 'order.events';
export const ORDER_CREATED_EVENT = 'order.created';

/** Payload stored in the outbox row and delivered to the worker.
 *  Includes the recipient email so the worker needs no extra DB query. */
export interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  email: string;
  product: string;
  quantity: number;
  amount: number;
}
