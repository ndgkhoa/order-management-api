import type { FastifyBaseLogger } from 'fastify';

export interface OutboxMessage {
  exchange: string;
  routingKey: string;
  payload: unknown;
  messageId: string;
}

export interface OutboxPublisher {
  publish(message: OutboxMessage): Promise<void>;
}

export function makeLogPublisher(log: FastifyBaseLogger): OutboxPublisher {
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
