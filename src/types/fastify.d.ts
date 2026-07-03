import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppConfig } from '@config/env-schema.js';
import type { DB } from '@infra/db/client.js';
import type { UserRole } from '@/types/user-role.js';

// Decorators added by our plugins, surfaced on the Fastify types.
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig; // @fastify/env (confKey)
    db: DB; // db plugin
    redis: Redis; // redis plugin
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; // jwt plugin
    requireRole: (role: UserRole) => (request: FastifyRequest) => Promise<void>; // rbac plugin
    // idempotency plugin — use in a route preHandler AFTER authenticate
    idempotency: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
  }

  interface FastifyRequest {
    idempotencyKey?: string; // set by idempotency preHandler when this request owns the key
    rawBody?: string; // raw request body captured by the payments webhook parser (HMAC verify)
  }
}

// Shapes for the JWT payload / authenticated user (set by request.jwtVerify()).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: UserRole };
    user: { sub: string; email: string; role: UserRole };
  }
}
