# Phase 04 — Fastify Core, Plugins, Health & Graceful Shutdown

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 03](./phase-03-db-layer-drizzle.md) (`db`, `closePool`).

## Overview

- **Priority:** P1 · **Status:** Pending
- **Description:** `app.ts` builder registers plugins (env, sensible, cors, helmet, rate-limit, jwt, swagger+ui, type-provider-typebox), Pino logging + request correlation id, `/health` (liveness) + `/ready` (DB & RabbitMQ check). `server.ts` listen + graceful shutdown (SIGTERM/SIGINT drain HTTP + close db/mq).

## Key Insights

- `buildApp()` returns a configured Fastify instance WITHOUT listening → reusable by `app.inject()` tests (phase 09). `server.ts` only does `listen` + signal handling. Separation = testability.
- Correlation ID: use `genReqId` + `requestIdHeader: 'x-request-id'` so Pino auto-logs `reqId`; propagate to traces in phase 08.
- `/health` = liveness (process up, no deps). `/ready` = readiness (DB `SELECT 1` + RabbitMQ connection open). K8s/compose use these.
- Plugin order matters: env first (config), then sensible, security, then type provider on instance. Register plugins via `fastify-plugin` where decorators must escape encapsulation (jwt, db).
- **API response convention (DECIDED):** success responses return the resource DIRECTLY (minimalist REST, no envelope). ALL errors use **RFC 7807 Problem Details** with `Content-Type: application/problem+json` and an added `requestId`. One global `setErrorHandler` normalizes everything — Fastify validation (400), `@fastify/sensible` httpErrors, JWT 401, rate-limit 429, unexpected 500 — into the same Problem shape. Single source of error truth (DRY).

## Requirements

**Functional:** app boots, swagger UI at `/docs`, `/health` 200, `/ready` 200 when deps up / 503 when down.
**Non-functional:** structured JSON logs (pretty in dev), graceful drain on signal.

## Architecture

```
server.ts → buildApp() → fastify.withTypeProvider<TypeBox>()
  register: env, sensible, cors, helmet, rate-limit, jwt, swagger, swaggerUi
  decorate: db (via plugin), config
  routes: health, ready, (modules added 05/06)
  listen → on SIGTERM/SIGINT → close(drain) → closePool → mq.close → exit
```

## Related Code Files

**Create:**

- `src/app.ts` (`buildApp()`)
- `src/server.ts` (listen + graceful shutdown)
- `src/plugins/env.ts`, `src/plugins/security.ts` (cors+helmet+rate-limit), `src/plugins/jwt.ts`, `src/plugins/swagger.ts`, `src/plugins/db.ts` (decorate `fastify.db`)
- `src/plugins/correlation-id.ts` (genReqId / hook)
- `src/plugins/error-handler.ts` (`setErrorHandler` → RFC 7807 Problem Details) + `src/infra/http/problem-details.ts` (Problem type + builders, TypeBox `ProblemSchema` for swagger)
- `src/modules/health/health-routes.ts` (`/health`, `/ready`)
  **Modify:** `src/infra/db/client.ts` (export ping helper).

## Implementation Steps

1. **app.ts**:

   ```ts
   import Fastify from 'fastify';
   import { TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';

   export async function buildApp() {
     const app = Fastify({
       logger: buildLoggerOptions(), // pino-pretty in dev
       requestIdHeader: 'x-request-id',
       genReqId: () => crypto.randomUUID(),
       disableRequestLogging: false,
     }).withTypeProvider<TypeBoxTypeProvider>();
     app.setValidatorCompiler(TypeBoxValidatorCompiler);

     await app.register(envPlugin); // @fastify/env validate -> app.config
     await app.register(sensible);
     await app.register(securityPlugin); // cors, helmet, rate-limit
     await app.register(jwtPlugin); // @fastify/jwt + authenticate decorator
     await app.register(swaggerPlugin);
     await app.register(dbPlugin); // decorate app.db
     await app.register(errorHandlerPlugin); // setErrorHandler -> RFC 7807
     await app.register(healthRoutes);
     // module routes registered in phases 05/06 with prefixes
     return app;
   }
   ```

   **RFC 7807 error handler** (`error-handler.ts`):

   ```ts
   app.setErrorHandler((err, req, reply) => {
     const status = err.statusCode ?? 500;
     if (status >= 500) req.log.error({ err }, 'unhandled error');
     const problem = {
       type: `https://fastify-drizzle/errors/${problemSlug(err)}`, // e.g. validation, unauthorized, internal
       title: titleFor(status),
       status,
       detail: status >= 500 ? 'Internal Server Error' : err.message, // never leak internals on 5xx
       instance: req.url,
       requestId: req.id,
       ...(err.validation ? { errors: err.validation } : {}), // AJV validation details on 400
     };
     reply.code(status).type('application/problem+json').send(problem);
   });
   app.setNotFoundHandler((req, reply) =>
     reply
       .code(404)
       .type('application/problem+json')
       .send({
         type: 'https://fastify-drizzle/errors/not-found',
         title: 'Not Found',
         status: 404,
         detail: `Route ${req.method} ${req.url} not found`,
         instance: req.url,
         requestId: req.id,
       }),
   );
   ```

   Success responses stay plain resources — controllers `return entity` / `reply.code(201).send(entity)`; TypeBox response schemas describe the resource directly (no envelope).

2. **env plugin** wraps `@fastify/env` with `schema: envSchema`, `confKey: 'config'`, `ajv.customOptions.coerceTypes`.
3. **security plugin** (`fastify-plugin`): `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` (`max: 100, timeWindow: '1m'`, in-memory).
4. **swagger plugin**: `@fastify/swagger` (openapi info) + `@fastify/swagger-ui` at `/docs`.
5. **db plugin**: `app.decorate('db', db)`; `addHook('onClose', () => closePool())`.
6. **correlation id**: reqId from `x-request-id` else uuid; add `onSend` hook to echo `x-request-id` back. Pino logs include `reqId` automatically.
7. **health routes**:
   ```ts
   app.get('/health', () => ({ status: 'ok' })); // liveness
   app.get('/ready', async (req, reply) => {
     const checks = { db: false, rabbitmq: false };
     try {
       await app.db.execute(sql`SELECT 1`);
       checks.db = true;
     } catch {}
     checks.rabbitmq = isMqHealthy(); // phase 07 sets this; stub true now
     const ok = checks.db && checks.rabbitmq;
     return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unready', checks });
   });
   ```
8. **server.ts graceful shutdown**:
   ```ts
   const app = await buildApp();
   await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
   let shuttingDown = false;
   for (const sig of ['SIGTERM', 'SIGINT'] as const) {
     process.on(sig, async () => {
       if (shuttingDown) return;
       shuttingDown = true;
       app.log.info({ sig }, 'graceful shutdown start');
       try {
         await app.close(); // stops accepting, drains in-flight, runs onClose (closePool, mq.close)
         process.exit(0);
       } catch (e) {
         app.log.error(e);
         process.exit(1);
       }
     });
   }
   ```
   Note: `app.close()` triggers `onClose` hooks → DB pool + MQ connection closed in correct order.

## Todo

- [ ] app.ts buildApp() with TypeBox provider + validator compiler
- [ ] env / security / jwt(stub) / swagger / db plugins
- [ ] correlation-id plugin (reqId + echo header)
- [ ] error-handler plugin: RFC 7807 Problem Details (validation/auth/404/500) + `application/problem+json` + requestId
- [ ] pino logger options (pretty dev / json prod)
- [ ] /health + /ready (db SELECT 1; mq stub)
- [ ] server.ts listen + SIGTERM/SIGINT graceful drain
- [ ] typecheck + boot smoke test (`/docs`, `/health`)

## Success Criteria

- App boots; `/docs` renders; `/health` 200; `/ready` 200 with pg up, 503 with pg down.
- SIGTERM drains and exits 0; logs JSON with `reqId`.

## Risk Assessment

- Plugin encapsulation: decorators (db/authenticate) must use `fastify-plugin` to be visible to routes. Common pitfall — call out.
- `/ready` mq check stubbed until phase 07; wire real check then.

## Security Considerations

- helmet headers, CORS allow-list (configurable), global rate-limit. JWT verify wired phase 05.

## Next Steps

Phase 05 registers auth/users routes on the instance + real `authenticate` preHandler.
