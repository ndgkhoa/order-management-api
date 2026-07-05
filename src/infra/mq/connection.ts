import amqp from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

let connection: AmqpConnection | null = null;
let connecting: Promise<AmqpConnection> | null = null;

export async function getConnection(log: FastifyBaseLogger): Promise<AmqpConnection> {
  if (connection) return connection;
  connecting ??= amqp.connect(process.env.RABBITMQ_URL ?? '').then((conn) => {
    conn.on('error', (err: unknown) => log.error({ err }, 'rabbitmq connection error'));
    conn.on('close', () => {
      log.warn('rabbitmq connection closed');
      connection = null;
      connecting = null;
    });
    connection = conn;
    return conn;
  });
  return connecting;
}

export function isMqHealthy(): boolean {
  return connection !== null;
}

export async function closeMq(): Promise<void> {
  if (connection) {
    const conn = connection;
    connection = null;
    connecting = null;
    await conn.close();
  }
}
