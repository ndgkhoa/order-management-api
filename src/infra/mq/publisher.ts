import type { FastifyBaseLogger } from 'fastify';
import { getConnection } from '@infra/mq/connection.js';
import { assertTopology } from '@infra/mq/topology.js';
import type { OutboxPublisher } from '@infra/mq/outbox-publisher.js';

export interface RabbitPublisher extends OutboxPublisher {
  close(): Promise<void>;
}

/**
 * RabbitMQ implementation of OutboxPublisher used by the outbox relay.
 * Uses a CONFIRM channel: publish resolves only after the broker acks, so the
 * relay marks `published_at` only once the message is durably accepted.
 */
export async function createRabbitPublisher(log: FastifyBaseLogger): Promise<RabbitPublisher> {
  const conn = await getConnection(log);
  const channel = await conn.createConfirmChannel();
  await assertTopology(channel);

  return {
    publish(message) {
      return new Promise<void>((resolve, reject) => {
        channel.publish(
          message.exchange,
          message.routingKey,
          Buffer.from(JSON.stringify(message.payload)),
          { persistent: true, messageId: message.messageId, contentType: 'application/json' },
          (err) => {
            if (err) reject(err instanceof Error ? err : new Error('publish nacked by broker'));
            else resolve();
          },
        );
      });
    },
    async close() {
      await channel.close();
    },
  };
}
