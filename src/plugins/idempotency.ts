import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IDEMPOTENCY_HEADER,
  PROCESSING_MARKER,
  PROCESSING_TTL_SECONDS,
  DONE_TTL_SECONDS,
} from '@/constants/index.js';

export function deriveIdempotencyKey(userId: string, routeId: string, header: string): string {
  return `idem:${userId}:${routeId}:${header}`;
}

interface StoredResponse {
  userId: string;
  status: number;
  contentType: string;
  payload: string;
}

function routeIdOf(req: FastifyRequest): string {
  return `${req.method}:${req.routeOptions.url ?? req.url}`;
}

export const idempotencyPlugin = fp((app) => {
  async function preHandler(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    const header = req.headers[IDEMPOTENCY_HEADER];
    if (typeof header !== 'string' || header.length === 0) return;
    const userId = req.user?.sub;
    if (!userId) return;

    const key = deriveIdempotencyKey(userId, routeIdOf(req), header);

    const acquired = await app.redis.set(
      key,
      PROCESSING_MARKER,
      'EX',
      PROCESSING_TTL_SECONDS,
      'NX',
    );
    if (acquired === 'OK') {
      req.idempotencyKey = key;
      return;
    }

    const existing = await app.redis.get(key);
    if (existing === null) return;
    if (existing === PROCESSING_MARKER) {
      throw app.httpErrors.conflict('a request with this Idempotency-Key is still processing');
    }

    const stored = JSON.parse(existing) as StoredResponse;
    if (stored.userId !== userId) {
      throw app.httpErrors.conflict('Idempotency-Key already used');
    }
    reply.header('idempotent-replayed', 'true');
    return reply.code(stored.status).type(stored.contentType).send(stored.payload);
  }

  app.decorate('idempotency', preHandler);

  app.addHook('onSend', async (req, reply, payload) => {
    const key = req.idempotencyKey;
    if (!key) return payload;

    try {
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        const stored: StoredResponse = {
          userId: req.user.sub,
          status: reply.statusCode,
          contentType: String(reply.getHeader('content-type') ?? 'application/json'),
          payload: typeof payload === 'string' ? payload : String(payload),
        };
        await app.redis.set(key, JSON.stringify(stored), 'EX', DONE_TTL_SECONDS);
      } else {
        await app.redis.del(key);
      }
    } catch (err) {
      req.log.warn({ err, key }, 'failed to persist idempotency result');
    }
    return payload;
  });

  return Promise.resolve();
});
