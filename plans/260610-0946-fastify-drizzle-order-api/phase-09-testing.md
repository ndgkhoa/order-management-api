# Phase 09 — Testing (Vitest + inject() + Testcontainers)

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 07](./phase-07-rabbitmq-and-email-worker.md) (full flow exists). Parallel with [Phase 08](./phase-08-observability.md).

## Overview

- **Priority:** P1 · **Status:** Pending
- **Description:** Vitest config + coverage. Unit tests (services, outbox relay, idempotency). API tests via `app.inject()` (register/login/create-order, auth failures, 400 validation). Testcontainers integration test: real Postgres + RabbitMQ verifying full order→outbox→publish→worker→Mailpit flow. **Real tests only — no fakes/mocks to force a pass.**

## Key Insights

- Three tiers: **unit** (pure logic, fast, deps via DI factory — pass a real lightweight stub ONLY where it's a true boundary), **api** (`buildApp()` + `inject()` against a Testcontainers pg), **integration** (full stack containers). Avoid mocking the DB — use a real Postgres container (matches prod behavior; tech-stack chose Testcontainers for this reason).
- `buildApp()` separation (phase 04) lets API tests run without opening a port.
- Idempotency test = deliver same `messageId` twice → assert single processed row + single email.
- Use Testcontainers `GenericContainer`/`PostgreSqlContainer` + RabbitMQ container; Mailpit container exposes REST API (`/api/v1/messages`) to assert email arrival.

## Requirements

**Functional:** all listed tests pass; coverage on services/relay/handler.
**Non-functional:** deterministic; containers torn down; CI-runnable.

## Architecture

```
unit/        services, outbox-relay loop, order-created-handler idempotency
api/         buildApp() + inject(): /auth/register, /auth/login, /orders (+ 401, 400, 409)
integration/ Testcontainers pg+rabbit+mailpit: POST /orders → relay → worker → assert Mailpit got 1 email
```

## Related Code Files

**Create:**

- `vitest.config.ts` (coverage v8, setupFiles, testTimeout high for containers)
- `test/helpers/build-test-app.ts` (boots app against a given DATABASE_URL/RABBITMQ_URL)
- `test/helpers/containers.ts` (start pg/rabbit/mailpit, run migrations)
- `test/unit/auth-service.test.ts`, `test/unit/outbox-relay.test.ts`, `test/unit/order-created-handler.test.ts`
- `test/api/auth.test.ts`, `test/api/orders.test.ts`
- `test/integration/order-flow.test.ts`

## Implementation Steps

1. **vitest.config.ts**: `test.environment 'node'`, `coverage.provider 'v8'`, `include ['test/**/*.test.ts']`, `testTimeout: 60_000` (integration), `globals: true`. Add `plugins: [tsconfigPaths()]` (from `vite-tsconfig-paths`) so `@/`, `@infra/`, `@modules/` aliases resolve in tests.
2. **containers.ts**:
   ```ts
   const pg = await new PostgreSqlContainer('postgres:17-alpine').start();
   const rabbit = await new GenericContainer('rabbitmq:4-management')
     .withExposedPorts(5672, 15672)
     .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
     .start();
   const mailpit = await new GenericContainer('axllent/mailpit')
     .withExposedPorts(1025, 8025)
     .start();
   process.env.DATABASE_URL = pg.getConnectionUri();
   process.env.RABBITMQ_URL = `amqp://${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
   // run drizzle migrate() against pg before tests
   ```
3. **unit/auth-service.test.ts**: real argon2 hash→verify; duplicate email throws conflict (repo stub returning existing). Assert no plaintext leaks.
4. **unit/outbox-relay.test.ts**: insert unsent outbox rows into real pg container; run one `tick()` with a fake publisher that records calls; assert rows published in order + `published_at` set; publisher throw → row stays unsent (retry semantics). The publisher boundary is the only stub (it's an external system seam, not business logic).
5. **unit/order-created-handler.test.ts**: deliver synthetic msg twice with same `messageId` against real pg container + recording mail adapter; assert exactly ONE `processed_messages` row + ONE send. Handler failure (mail throws) → no processed row + returns 'retry'.
6. **api/auth.test.ts** (`inject()`): register 201; duplicate 409; login 200 returns token; bad body 400; wrong password 401.
7. **api/orders.test.ts**: without token 401; with token 201 + order returned; assert outbox row created (query pg). Validation: quantity 0 → 400.
8. **integration/order-flow.test.ts** (the showcase): boot app + start outbox relay + start email worker (all against containers). POST /orders with auth → poll Mailpit `GET http://host:mappedPort/api/v1/messages` until 1 message whose `To` == order email. Assert order.status, outbox `published_at` not null, processed_messages has the id. Tear down containers in `afterAll`.
9. CI note (phase 10): Testcontainers needs Docker available on the runner (GitHub Actions has it).

## Todo

- [ ] vitest.config.ts + coverage
- [ ] test helpers: build-test-app, containers (pg/rabbit/mailpit + migrate)
- [ ] unit: auth-service (argon2), outbox-relay, idempotent handler
- [ ] api: auth (register/login/409/400/401), orders (401/201/400 + outbox row)
- [ ] integration: full order→outbox→publish→worker→Mailpit assertion
- [ ] `npm run test` green; coverage report generated

## Success Criteria

- All tiers pass with REAL pg + rabbit + mailpit (no mock-to-pass).
- Idempotency proven (1 email on double delivery). Full-flow integration asserts Mailpit received email.
- Coverage report emitted; CI can run it.

## Risk Assessment

- Testcontainers slow / flaky on first pull — set generous timeouts + log wait strategies.
- Worker + relay timing in integration → poll with retry/backoff, not fixed sleep.
- Docker required in CI — ensure runner has it (Actions default does).

## Security Considerations

- Tests use throwaway containers/creds; nothing persisted. No real secrets.

## Next Steps

Phase 10 wires these into GitHub Actions before docker build/push.
