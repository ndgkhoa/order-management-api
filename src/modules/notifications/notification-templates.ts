import {
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
} from '@infra/mq/outbox-event-types.js';
import type { NotificationMessage } from '@infra/channels/notification-provider.js';

/** The subset of saga-event payload fields the templates read (all carry `orderId`). */
export interface NotifyPayload {
  orderId: string;
  reason?: string;
  status?: string;
}

export interface NotificationRoute {
  channels: string[];
  render: (payload: NotifyPayload) => NotificationMessage;
}

/**
 * Routing table: which user-facing saga events notify, on which channels, and how they render.
 * Templates are kept separate from transport — a route only produces a `{subject, body}`. Events
 * not in this table (e.g. `order.created`, `shipment.ready_for_pickup`) are intentionally NOT
 * notified here and resolve to `undefined` (no-op).
 */
const ROUTES: Record<string, NotificationRoute> = {
  [ORDER_PAID_EVENT]: {
    channels: ['email'],
    render: (p) => ({
      subject: `Order ${p.orderId} confirmed`,
      body: `Your payment succeeded and order ${p.orderId} is confirmed. We'll ship it shortly.`,
    }),
  },
  [ORDER_CANCELLED_EVENT]: {
    channels: ['email'],
    render: (p) => ({
      subject: `Order ${p.orderId} cancelled`,
      body: `Your order ${p.orderId} was cancelled${p.reason ? ` (${p.reason})` : ''}.`,
    }),
  },
  [ORDER_REFUNDED_EVENT]: {
    channels: ['email'],
    render: (p) => ({
      subject: `Order ${p.orderId} refunded`,
      body: `A refund for order ${p.orderId} has been issued to your original payment method.`,
    }),
  },
  [SHIPMENT_IN_TRANSIT_EVENT]: {
    channels: ['email'],
    render: (p) => ({
      subject: `Order ${p.orderId} is on its way`,
      body: `Good news — order ${p.orderId} is in transit.`,
    }),
  },
  [SHIPMENT_DELIVERED_EVENT]: {
    channels: ['email', 'sms'], // exercises the multi-channel abstraction
    render: (p) => ({
      subject: `Order ${p.orderId} delivered`,
      body: `Your order ${p.orderId} has been delivered. Enjoy!`,
    }),
  },
};

/** The notification route for an event type, or undefined if it should not notify. */
export function routeNotification(eventType: string): NotificationRoute | undefined {
  return ROUTES[eventType];
}
