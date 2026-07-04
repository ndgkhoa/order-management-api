import { eq } from 'drizzle-orm';
import type { ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { orders, users } from '@infra/db/schema.js';
import type { HandlerResult } from '@infra/mq/consumer.js';
import type { NotificationProvider } from '@infra/providers/notification-provider.js';
import { parseEnvelope, claimOnce } from '@infra/mq/idempotent-consumer.js';
import {
  routeNotification,
  type NotifyPayload,
} from '@modules/notifications/notification-templates.js';

/** Distinct dedup dimension so notifications are exactly-once independent of the email consumer. */
const CONSUMER_NAME = 'notify';

interface HandlerDeps {
  db: DB;
  providers: Record<string, NotificationProvider>;
  log: FastifyBaseLogger;
}

/**
 * Channel-agnostic notification consumer. Maps an event type → route (channels + template),
 * looks up the order owner's address, renders once, and fans out to each channel's provider.
 * Idempotent: (consumer='notify', eventId) is inserted in the SAME tx as the dispatch, so a
 * redelivery sends nothing. A send failure rolls the tx back (no processed row) → retry.
 * Unrouted events (e.g. order.created) are acked without side effect.
 */
export function makeNotificationDispatcher({ db, providers, log }: HandlerDeps) {
  return async (msg: ConsumeMessage): Promise<HandlerResult> => {
    const envelope = parseEnvelope<NotifyPayload>(msg, log);
    if (!envelope) return 'ack';
    const eventId = envelope.eventId;

    const route = routeNotification(envelope.eventType);
    if (!route) return 'ack'; // not a notification-worthy event → no-op

    try {
      let duplicate = false;
      await db.transaction(async (tx) => {
        if (!(await claimOnce(tx, CONSUMER_NAME, eventId))) {
          duplicate = true;
          return;
        }

        const orderId = envelope.payload.orderId;
        const [recipient] = await tx
          .select({ email: users.email })
          .from(orders)
          .innerJoin(users, eq(users.id, orders.userId))
          .where(eq(orders.id, orderId));
        if (!recipient) {
          log.warn({ orderId }, 'no recipient for notification; skipping dispatch');
          return;
        }

        // Dedup is per-EVENT, not per-(event, channel): if a later channel throws, the whole tx
        // rolls back and the retry re-sends the earlier channels too. Safe today because the only
        // multi-channel route uses the no-throw SMS stub. Before shipping a channel that can throw,
        // switch to per-channel dedup (or best-effort dispatch of non-critical channels).
        const message = route.render(envelope.payload);
        for (const channel of route.channels) {
          const provider = providers[channel];
          if (provider) await provider.send(recipient.email, message);
          else log.warn({ channel }, 'no provider registered for channel; skipping');
        }
      });

      if (duplicate) log.info({ eventId }, 'duplicate notification delivery, skipped');
      return 'ack';
    } catch (err) {
      log.error({ err, eventId }, 'notification handler failed');
      return 'retry';
    }
  };
}
