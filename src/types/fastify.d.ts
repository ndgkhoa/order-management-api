import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppConfig } from '@config/env-schema';
import type { DB } from '@infra/db/client';
import type { UserRole } from '@/types/user-role';
import type { Permission } from '@/types/permission';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: DB;
    redis: Redis;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permission: Permission) => (request: FastifyRequest) => Promise<void>;
    idempotency: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
  }

  interface FastifyRequest {
    idempotencyKey?: string;
    rawBody?: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; roles: UserRole[] };
    user: { sub: string; email: string; roles: UserRole[] };
  }
}
