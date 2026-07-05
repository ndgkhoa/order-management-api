import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { orders, users } from '@infra/db/schema';
import type { HandlerResult } from '@infra/mq/consumer';
import type { NotificationProvider } from '@modules/notifications/notification-interface';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer';
import { NOTIFY_CONSUMER } from '@/constants/index';
import {
  makeNotificationsService,
  type NotifyPayload,
} from '@modules/notifications/notifications-service';

interface HandlerDeps {
  db: DB;
  providers: Record<string, NotificationProvider>;
  log: FastifyBaseLogger;
}

export function makeNotificationDispatcher({ db, providers, log }: HandlerDeps) {
  const notifications = makeNotificationsService();
  return async (msg: ConsumeMessage): Promise<HandlerResult> => {
    const envelope = parseEnvelope<NotifyPayload>(msg, log);
    if (!envelope) return 'ack';
    const eventId = envelope.eventId;

    const route = notifications.route(envelope.eventType);
    if (!route) return 'ack';

    let claimed = false;
    let recipientEmail: string | undefined;
    try {
      await db.transaction(async (tx) => {
        if (!(await claimOnce(tx, NOTIFY_CONSUMER, eventId))) return;
        claimed = true;
        const [recipient] = await tx
          .select({ email: users.email })
          .from(orders)
          .innerJoin(users, eq(users.id, orders.userId))
          .where(eq(orders.id, envelope.payload.orderId));
        recipientEmail = recipient?.email;
      });
    } catch (err) {
      log.error({ err, eventId }, 'notification dedup/lookup failed');
      return 'retry';
    }

    if (!claimed) {
      log.info({ eventId }, 'duplicate notification delivery, skipped');
      return 'ack';
    }
    if (!recipientEmail) {
      log.warn({ orderId: envelope.payload.orderId }, 'no recipient for notification; skipping');
      return 'ack';
    }

    const message = route.render(envelope.payload);
    for (const channel of route.channels) {
      const provider = providers[channel];
      if (!provider) {
        log.warn({ channel }, 'no provider registered for channel; skipping');
        continue;
      }
      try {
        await provider.send(recipientEmail, message);
      } catch (err) {
        log.error(
          { err, eventId, channel },
          'notification send failed (dedup committed, not retried)',
        );
      }
    }
    return 'ack';
  };
}
