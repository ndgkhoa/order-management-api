import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';

const HEADER = 'idempotency-key';
const PROCESSING = '__processing__';
// Short marker TTL: if the owner crashes between acquiring the marker and persisting
// the response, retries are blocked only for seconds — not the full replay window.
const PROCESSING_TTL_SECONDS = 30;
// Replay window for a completed response.
const DONE_TTL_SECONDS = 60 * 60 * 24; // 24h

/** Redis key for an idempotent request. Scoped by user AND route so a client key can
 *  never replay another user's — or another endpoint's — stored response. */
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

/**
 * HTTP `Idempotency-Key` layer (Redis-backed). Opt-in per route by adding `app.idempotency`
 * to the route's `preHandler` array AFTER `app.authenticate` (the key is scoped by the
 * verified `req.user.sub`, so auth must run first — an instance-level preHandler would run
 * too early). A global `onSend` hook persists the response of the OWNING request only.
 *
 * Flow: first request `SET NX` a short-lived processing marker → runs the handler → onSend
 * stores {status, body} under a long TTL. A retry with the same key replays that stored
 * response; a retry hitting the in-flight marker gets 409. Only 2xx responses are cached
 * (errors are never replayed); the owner check on replay is defense-in-depth against a
 * leaked key.
 */
export const idempotencyPlugin = fp((app) => {
  async function preHandler(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    const header = req.headers[HEADER];
    if (typeof header !== 'string' || header.length === 0) return; // no key → normal path
    const userId = req.user?.sub;
    if (!userId) return; // runs after authenticate; a missing user is handled upstream

    const key = deriveIdempotencyKey(userId, routeIdOf(req), header);

    // Become the owner: atomically claim the key with a short-lived processing marker.
    const acquired = await app.redis.set(key, PROCESSING, 'EX', PROCESSING_TTL_SECONDS, 'NX');
    if (acquired === 'OK') {
      req.idempotencyKey = key; // owner → onSend persists the response
      return;
    }

    const existing = await app.redis.get(key);
    if (existing === null) return; // marker expired between SET and GET (rare) → proceed
    if (existing === PROCESSING) {
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

  // Persist the response for the owning request only: cache 2xx, drop the marker otherwise
  // so a failed request can be retried immediately rather than replaying an error.
  app.addHook('onSend', async (req, reply, payload) => {
    const key = req.idempotencyKey;
    if (!key) return payload;

    // The response is already produced; a Redis failure here must not turn a successful
    // handler into a 500. Log and move on (worst case: the short marker expires and a
    // retry is treated as a fresh request).
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
