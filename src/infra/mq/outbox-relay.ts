import { eq, isNull } from 'drizzle-orm';
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '@infra/db/client.js';
import { outboxMessages } from '@infra/db/schema.js';
import { ORDER_EVENTS_EXCHANGE } from '@infra/mq/outbox-event-types.js';
import { createEventEnvelope } from '@infra/mq/event-envelope.js';
import type { OutboxPublisher } from '@infra/mq/outbox-publisher.js';

interface OutboxRelayDeps {
  db: DB;
  publisher: OutboxPublisher;
  log: FastifyBaseLogger;
  intervalMs: number;
  batchSize?: number;
}

/**
 * Transactional Outbox relay: polls unpublished outbox rows and publishes them,
 * marking `published_at`. Publish happens INSIDE the row's transaction (lock held)
 * so a crash mid-flight leaves the row unpublished → retried next tick (at-least-once;
 * the consumer must be idempotent). `FOR UPDATE SKIP LOCKED` lets multiple instances
 * run without double-processing a row.
 */
export function createOutboxRelay({
  db,
  publisher,
  log,
  intervalMs,
  batchSize = 20,
}: OutboxRelayDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running = false; // prevents overlapping ticks

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
          // Resume the trace captured when the row was written, so amqplib injects
          // the original traceparent into the message → the worker's consume span
          // joins the same trace as the originating HTTP request. Because this publish
          // keeps the request as parent, its producer span is never an orphan and so
          // survives the relay-poll span filter in telemetry/otel.ts.
          const parentCtx = propagation.extract(ROOT_CONTEXT, row.traceContext ?? {});
          // Publish the versioned envelope as the message body; the AMQP messageId is the
          // logical eventId so consumers dedupe on the same key the envelope carries.
          const envelope = createEventEnvelope({
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
    tick, // exposed so tests can drive a single poll deterministically
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

export type OutboxRelay = ReturnType<typeof createOutboxRelay>;
