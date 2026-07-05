import {
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_REFUNDED_EVENT,
  SHIPMENT_IN_TRANSIT_EVENT,
  SHIPMENT_DELIVERED_EVENT,
} from '@infra/mq/outbox-event-types.js';
import type { NotificationMessage } from '@modules/notifications/notification-interface.js';

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
      channels: ['email', 'sms'],
      render: (p) => ({
        subject: `Order ${p.orderId} delivered`,
        body: `Your order ${p.orderId} has been delivered. Enjoy!`,
      }),
    },
  };

  return {
    route(eventType: string): NotificationRoute | undefined {
      return routes[eventType];
    },
  };
}

export type NotificationsService = ReturnType<typeof makeNotificationsService>;
