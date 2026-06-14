import type { FastifyBaseLogger } from 'fastify';

/** A message the outbox relay hands to a publisher. */
export interface OutboxMessage {
  exchange: string;
  routingKey: string;
  payload: unknown;
  messageId: string;
}

/** Publisher contract. Phase 07 provides the real RabbitMQ implementation. */
export interface OutboxPublisher {
  publish(message: OutboxMessage): Promise<void>;
}

/**
 * STUB used until phase 07: logs instead of sending to RabbitMQ, so the relay
 * loop is fully exercisable now. Swap for the RabbitMQ publisher in phase 07.
 */
export function createLogPublisher(log: FastifyBaseLogger): OutboxPublisher {
  return {
    publish(message) {
      log.info(
        { messageId: message.messageId, routingKey: message.routingKey },
        'outbox publish (stub — not sent to RabbitMQ yet)',
      );
      return Promise.resolve();
    },
  };
}
