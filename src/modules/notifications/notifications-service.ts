import {
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
} from '@infra/mq/outbox-event-types.js';
import type { NotificationMessage } from '@infra/providers/notification-provider.js';

/** The subset of saga-event payload fields the templates read (all carry `orderId`; the
 *  order-created template also lists the ordered lines + total). */
export interface NotifyPayload {
  orderId: string;
  reason?: string;
  status?: string;
  items?: { sku: string; quantity: number }[];
  totalCents?: number;
}

export interface NotificationRoute {
  channels: string[];
  render: (payload: NotifyPayload) => NotificationMessage;
}

/**
 * Notifications business logic: which user-facing saga events notify, on which channels, and how
 * they render. Templates are kept separate from transport — a route only produces a
 * `{subject, body}`; the dispatch subscriber delivers it via the channel providers. Events not in
 * the table (e.g. `shipment.ready_for_pickup`) resolve to `undefined` (no-op).
 */
export function makeNotificationsService() {
  const routes: Record<string, NotificationRoute> = {
    [ORDER_CREATED_EVENT]: {
      channels: ['email'],
      render: (p) => {
        const lines = (p.items ?? []).map((i) => `  ${i.quantity}x ${i.sku}`).join('\n');
        return {
          subject: `Order ${p.orderId} received`,
          body: `Hi! Your order is confirmed:\n${lines}\nTotal: ${((p.totalCents ?? 0) / 100).toFixed(2)}`,
        };
      },
    },
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

  return {
    /** The notification route for an event type, or undefined if it should not notify. */
    route(eventType: string): NotificationRoute | undefined {
      return routes[eventType];
    },
  };
}

export type NotificationsService = ReturnType<typeof makeNotificationsService>;
