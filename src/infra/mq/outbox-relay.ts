import { eq, isNull } from 'drizzle-orm';
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client';
import { outboxMessages } from '@infra/db/schema';
import { ORDER_EVENTS_EXCHANGE } from '@infra/mq/outbox-event-types';
import { buildEventEnvelope } from '@infra/mq/event-envelope';
import type { OutboxPublisher } from '@infra/mq/outbox-publisher';

interface OutboxRelayDeps {
  db: DB;
  publisher: OutboxPublisher;
  log: FastifyBaseLogger;
  intervalMs: number;
  batchSize?: number;
}

export function makeOutboxRelay({
  db,
  publisher,
  log,
  intervalMs,
  batchSize = 20,
}: OutboxRelayDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(outboxMessages)
          .where(isNull(outboxMessages.publishedAt))
          .orderBy(outboxMessages.createdAt)
          .limit(batchSize)
          .for('update', { skipLocked: true });

        for (const row of rows) {
          const parentCtx = propagation.extract(ROOT_CONTEXT, row.traceContext ?? {});
          const envelope = buildEventEnvelope({
            eventId: row.eventId,
            eventType: row.eventType,
            correlationId: row.correlationId ?? row.aggregateId,
            payload: row.payload,
            occurredAt: row.createdAt,
          });
          await context.with(parentCtx, () =>
            publisher.publish({
              exchange: ORDER_EVENTS_EXCHANGE,
              routingKey: row.eventType,
              payload: envelope,
              messageId: row.eventId,
            }),
          );
          await tx
            .update(outboxMessages)
            .set({ publishedAt: new Date() })
            .where(eq(outboxMessages.id, row.id));
        }
      });
    } catch (err) {
      log.error({ err }, 'outbox relay tick failed; will retry next tick');
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      log.info({ intervalMs }, 'outbox relay started');
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log.info('outbox relay stopped');
    },
  };
}

export type OutboxRelay = ReturnType<typeof makeOutboxRelay>;
