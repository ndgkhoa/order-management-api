---
phase: 5
title: 'Idempotency & Rate-Limit'
status: completed
priority: P2
effort: '5h'
dependencies: [3]
---

# Phase 5: Idempotency & Rate-Limit

## Overview

Add an HTTP `Idempotency-Key` layer (Redis-backed) so retried mutating POSTs return the original response instead of creating duplicate orders, and move rate-limiting to a Redis backend for multi-instance correctness.

## Requirements

- Functional: `POST /orders` (and other mutating POSTs) honor `Idempotency-Key` header; same key+route+user → replay stored response (status+body), no new side effect; first request stores result after success. Rate-limit shared across instances via Redis.
- Non-functional: keys TTL'd (e.g. 24h); in-flight concurrency safe (lock or atomic SETNX while processing); key scoped per user+route to avoid cross-tenant collisions.

## Architecture

- `src/plugins/idempotency.ts` — preHandler: if header present, key = `idem:{userId}:{routeId}:{Idempotency-Key}`. `SETNX` a "processing" marker; if exists+completed → return stored response; if processing → 409 retry-later. onSend hook stores `{status, body}` under the key with TTL.
- Opt-in per route via config (orders POST, later payments mock endpoints). Keep generic + reusable.
- Rate-limit: switch `@fastify/rate-limit` to Redis store (`@fastify/rate-limit` redis option using `fastify.redis`). Configured in `src/plugins/security.ts`.

## Related Code Files

- Create: `src/plugins/idempotency.ts`
- Modify: `src/plugins/security.ts` (rate-limit redis store), `src/modules/orders/orders-routes.ts` (enable idempotency), `src/app.ts` (register plugin), `src/types/fastify.d.ts` (config flag)

## TDD — Tests First

1. `test/integration/idempotency.test.ts` — same Idempotency-Key twice → ONE order created, identical response replayed; different key → new order; concurrent same-key → one wins, other gets replay/409.
2. `test/unit/idempotency-key.test.ts` — key derivation scoping (user+route+header); TTL set.
3. `test/integration/rate-limit-redis.test.ts` — limit enforced via Redis store (counter shared).

## Implementation Steps

1. Write failing tests.
2. Implement `idempotency.ts` plugin (SETNX marker → process → store on onSend).
3. Enable on `POST /orders`.
4. Configure rate-limit Redis store in `security.ts`.
5. typecheck + lint + tests green.

## Success Criteria

- [x] Retried POST /orders with same key → single order, replayed response.
- [x] Concurrent same-key handled (no double create).
- [x] Keys scoped per user+route, TTL'd.
- [x] Rate-limit backed by Redis (shared across instances).
- [x] typecheck + lint + tests green.

## Implementation Notes (delta from spec)

- Idempotency wired as a route-level preHandler decorator `app.idempotency` (used as
  `preHandler: [app.authenticate, app.idempotency]`), NOT a global preHandler + route config
  flag: an instance-level preHandler runs before the route's `authenticate`, so `req.user.sub`
  (the key's tenant scope) wouldn't exist yet. Storage stays a global `onSend` hook gated on a
  `request.idempotencyKey` ownership flag.
- Rate limit uses a DEDICATED fail-fast Redis connection (`connectTimeout` + `enableOfflineQueue:false`)
  with `skipOnError: true`, not the shared `app.redis`. The shared client waits through reconnects
  (`maxRetriesPerRequest:null`); on the app-wide onRequest path that would hang every route (incl.
  health) during a Redis blip. Rate limiting now degrades OPEN.
- Added `RATE_LIMIT_MAX` / `RATE_LIMIT_TIME_WINDOW` env (defaults 100 / '1 minute'); test env raises
  the ceiling so the shared client IP doesn't self-trip during the suite.
- Known accepted tradeoffs (availability over strict dedup): a crash between DB commit and the
  onSend store, or a create handler exceeding the 30s processing-marker TTL, can allow a duplicate
  order on retry. Consistent with the async-saga design; order create is fast today.

## Risk Assessment

- Storing response before side effect commits → store only AFTER handler success (onSend), keep a short "processing" marker meanwhile.
- Body serialization for replay → store JSON; replay sets same content-type/status.
- Don't over-scope: only POST /orders now; payment webhook has its OWN dedup (phase 6).

## Red Team Hardening (High — apply in this phase)

- **No poison marker.** A crash between `SETNX` (processing marker) and the `onSend` store leaves a permanent marker → every retry gets 409 for the whole 24h TTL (self-DoS). Fix: processing marker gets a SHORT TTL (seconds, ~ request timeout); completion overwrites it with the stored response + long TTL. A stale processing marker must expire fast, not block for a day.
- **Cache only success.** `onSend` fires for 4xx/5xx too. Gate storage to `2xx` responses only — never cache/replay an error.
- **Re-verify owner on replay.** Key is `idem:{userId}:{routeId}:{key}`, but on replay assert the requesting `userId` matches the stored key's user before returning the body — defense in depth against a leaked key replaying another user's response.
