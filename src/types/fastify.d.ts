import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppConfig } from '@config/env-schema.js';
import type { DB } from '@infra/db/client.js';

// Decorators added by our plugins, surfaced on the Fastify types.
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig; // @fastify/env (confKey)
    db: DB; // db plugin
    redis: Redis; // redis plugin
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>; // jwt plugin
    requireRole: (role: string) => preHandlerHookHandler; // rbac plugin
  }
}

// Shapes for the JWT payload / authenticated user (set by request.jwtVerify()).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: string };
    user: { sub: string; email: string; role: string };
  }
}
