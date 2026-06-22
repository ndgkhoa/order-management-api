---
phase: 1
title: 'Foundation & Event Envelope'
status: completed
priority: P1
effort: '6h'
dependencies: []
---

# Phase 1: Foundation & Event Envelope

## Overview

Stand up Redis + RBAC, and standardize a versioned event envelope (`eventId`, `correlationId`, `occurredAt`) across the outbox so every later saga event is dedupe-able and traceable. Touches the existing `order.created` path, so do it first.

## Requirements

- Functional: Redis reachable via a Fastify plugin + standalone worker client; `users.role` exists with a route guard; all outbox events carry an envelope; consumer dedup keyed on `eventId`.
- Non-functional: envelope change is backward-safe for in-flight rows; no plaintext secrets; Redis optional-fail-fast at boot (required in prod, mockable in tests).

## Architecture

- New env: `REDIS_URL`, `WEBHOOK_HMAC_SECRET` (used phase 6, declare now), keep validation at boot (`src/config/env-schema.ts`).
- `ioredis` client: `src/infra/redis/client.ts` (factory) + `src/plugins/redis.ts` (decorates `fastify.redis`, closes on shutdown). Worker builds its own client.
- Event envelope: `src/infra/mq/event-envelope.ts` — `{ eventId: uuid, eventType, correlationId, occurredAt: ISO, payload }`. Outbox writes set `event_id` (new col) + `correlation_id` (new col, = aggregateId/order_id). Publisher injects envelope as the message body; consumer reads `eventId` for dedup.
- DB migration: `outbox_messages` + `event_id uuid not null` (logical event id, stable across re-emit) + `correlation_id text`; `processed_messages` becomes a **composite PK (`consumer_name text`, `event_id uuid`)** — drop the old single `message_id` PK (see Red Team Hardening for why the outbox-row-id key was insufficient). Document the composite key in the migration comment.
- RBAC: `users.role text not null default 'customer'` (values `customer|admin`); `src/plugins/rbac.ts` adds `fastify.requireRole('admin')` preHandler reading `request.user.role` from JWT. JWT payload + sign updated to include `role`.

## Related Code Files

- Create: `src/infra/redis/client.ts`, `src/plugins/redis.ts`, `src/infra/mq/event-envelope.ts`, `src/plugins/rbac.ts`
- Create migration: `drizzle/0002_*.sql` (via `npm run db:generate` after schema edit)
- Modify: `src/config/env-schema.ts` (REDIS_URL, WEBHOOK_HMAC_SECRET), `.env.example`, `docker-compose.yml` (redis service), `src/infra/db/schema.ts` (users.role, outbox event_id+correlation_id), `src/app.ts` (register redis+rbac plugins), `src/infra/mq/outbox-publisher.ts` + `outbox-relay.ts` (envelope), `src/infra/mq/consumer.ts` + worker dedup, `src/modules/orders/orders-repository.ts` (write event_id+correlation_id), `src/modules/auth/auth-service.ts`+`jwt.ts` (role in token), `src/types/fastify.d.ts` (redis, requireRole decorators)

## TDD — Tests First

1. `test/unit/event-envelope.test.ts` — envelope factory produces uuid eventId, ISO occurredAt, passes through payload/correlationId.
2. Redis container added to `test/global-setup.ts`. (A dedicated `redis-plugin.test.ts` was dropped as redundant — `redisPlugin` pings at boot, so every app-building test already exercises it; real Redis logic gets tested in phases 5/6.)
3. `test/unit/rbac-guard.test.ts` — `requireRole('admin')` 403s a customer token, passes an admin token.
4. `test/unit/outbox-dedup-by-event-id.test.ts` — duplicate eventId → second insert into processed_messages conflicts → skip.
5. Update existing `test/unit/outbox-relay.test.ts` to assert published body now wraps the envelope (lock new shape).

## Implementation Steps

1. Add Redis service to `docker-compose.yml` + `REDIS_URL`/`WEBHOOK_HMAC_SECRET` to env schema + `.env.example`.
2. Write failing tests (above); add Redis Testcontainer to global setup.
3. Implement `redis/client.ts` + `plugins/redis.ts`; register in `app.ts`; worker client in `src/workers/`.
4. Schema: add `users.role`, `outbox_messages.event_id`, `outbox_messages.correlation_id`; `npm run db:generate` → review SQL → `db:migrate`.
5. Implement `event-envelope.ts`; wire publisher/relay/consumer + orders-repository to emit/read it; switch dedup to eventId.
6. Implement `rbac.ts` + add `role` to JWT sign/verify + `fastify.d.ts` types.
7. `npm run typecheck && npm run lint && npm test` → all green.

## Success Criteria

- [ ] Redis container up; `fastify.redis.ping()` green in test + dev.
- [ ] Every outbox row has `event_id` + `correlation_id`; relay publishes envelope; consumer dedups on `eventId`.
- [ ] `users.role` migrated; `requireRole('admin')` blocks customers (403).
- [ ] JWT carries `role`; existing auth/orders tests still pass after envelope change.
- [ ] typecheck + lint + tests green.

## Risk Assessment

- Envelope change touches the live `order.created` path → mitigate by updating `outbox-relay.test.ts` first (TDD locks shape).
- Redis as new boot dependency → fail-fast with clear error; tests use Testcontainer, never real infra.

## Red Team Hardening (Critical/High — apply in this phase)

- **Composite dedup key (replaces single-column `message_id`).** Current `processed_messages` PK is `message_id` = the outbox **row id** (`src/infra/db/schema.ts:52-55`), keyed per-publish. This breaks the saga two ways: (a) fan-out — inventory + email both consume `OrderCreated`; first insert wins, the second silently skips its side effect; (b) a re-emitted logical event (new row id) won't dedup. Fix: dedup PK = **(`consumer_name`, `event_id`)** where `event_id` is the **logical** event id from the envelope (stable across re-emit), NOT the outbox row id. Migration: `processed_messages` → `consumer_name text`, `event_id uuid`, composite PK; each consumer passes its own name. (Resolves the conflicting "drop event_id" suggestion — `event_id` is required; it is the logical id, distinct from the outbox row id.)
- **Relay must run in every process that emits.** `outbox-relay` starts only in `src/server.ts:25`; workers (`src/workers/email-worker.ts`) run consumers with NO relay. Saga events emitted by consumers (`InventoryReserved`, `PaymentCreated`, …) would never publish. Fix: start a relay loop in the worker process too (shared `createOutboxRelay`), OR run a dedicated relay process; plus add a stuck-order reaper (sweep `pending` orders older than N min → log/alert/manual recovery). Decide and document which process owns the relay.
  - **DEFERRED to Phase 4** (decision 2026-06-22): no worker emits outbox events until the inventory consumer exists, so wiring relay-into-worker now would relay nothing (YAGNI). `createOutboxRelay` is already a reusable factory; Phase 4 wires it into the worker process and adds the stuck-order reaper at the point an emitter actually exists. See phase-04 hardening.
- **Install `ioredis` in this phase.** `package.json` has no `ioredis` (only `@fastify/rate-limit@^11`). Add `ioredis` as a dependency in Implementation Step 1; `@fastify/rate-limit` v11 redis store requires it.
- **Queue-per-consumer topology.** `topology.ts` declares ONE queue (`ORDER_EMAIL_QUEUE`) bound to `order.created`. Each new saga consumer MUST get its OWN durable queue (+ DLQ) bound to the topic exchange — reusing one queue makes consumers competing (round-robin split), not fan-out. State explicitly: one queue + one worker per saga step.
- **RBAC fully specified.** `users` has no `role` today; `signToken` signs `{sub,email}` only (`src/modules/auth/auth-service.ts`). Spec the full coupled change set: migration (`users.role`), JWT sign + verify payload, `src/types/fastify.d.ts`, an admin seed/bootstrap path, and `requireRole` reading role from the **verified** claim only. Accept (and document) that role is claim-sourced → a revoked admin stays admin until token expiry (~15m); acceptable for portfolio, but state it.
  - **Admin bootstrap (decision 2026-06-22):** `npm run db:seed` → `src/infra/db/seeds/index.ts` (seed _runner_ registering a `seeders[]` array, so future seeds plug in) → `seedAdmin` in `src/infra/db/seeds/seed-admin.ts`, hardcoded dev creds (`admin@orders.local` / `admin1234`), idempotent upsert. No env vars (per user). Dev-only; not for production.
  - **Test layout (decision 2026-06-22):** `test/unit` split by domain — `test/unit/{auth,orders,mq}/` (vitest discovers `test/**` recursively; tests use `@`-aliases so location-independent).
- **`WEBHOOK_HMAC_SECRET` strength floor.** Declare with `minLength: 32` in `env-schema.ts` (mirror `JWT_SECRET`); `.env.example` placeholder must be an obvious non-secret.
