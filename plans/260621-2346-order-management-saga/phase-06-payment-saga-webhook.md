---
phase: 6
title: 'Payment Saga & Webhook'
status: completed
priority: P1
effort: '8h'
dependencies: [4]
---

# Phase 6: Payment Saga & Webhook

## Overview

The saga heart: `InventoryReserved` → create payment → a mock provider calls back an HMAC-signed webhook → `PaymentSucceeded`/`PaymentFailed`. Success commits the reservation and emits `OrderPaid`; failure releases inventory and cancels the order (compensation). Demonstrates Outbox + webhook signature + webhook idempotency + saga compensation.

## Requirements

- Functional:
  - `InventoryReserved` consumer → insert `payments(pending)` + emit `PaymentCreated`.
  - Mock provider (`PaymentCreated` consumer) → after delay POST `/webhooks/payment` with HMAC `X-Signature`.
  - Webhook controller → verify HMAC + timestamp → Redis dedup (`processed:webhook:{providerEventId}`, durable backstop) → update payment → emit `PaymentSucceeded|PaymentFailed`.
  - `PaymentSucceeded` → order `paid`, `stock_reserved -= q` (commit reservation) → emit `OrderPaid`.
  - `PaymentFailed` → release (`stock_available += q, stock_reserved -= q`) → order `cancelled` → emit `OrderCancelled`.
  - Control endpoints: `POST /mock-payments/:id/succeed`, `POST /mock-payments/:id/fail` to force outcomes.
- Non-functional: bad signature → 401 before ANY side effect; duplicate webhook → single side effect; every transition idempotent + status-guarded.

## Architecture

- Module `src/modules/payments/` (routes, controller, service, repository, schema). State machine `pending → paid|failed|refunded` in `payment-status.ts`.
- HMAC: `src/modules/payments/webhook-signature.ts` — `sign(payload) = HMAC_SHA256(WEBHOOK_HMAC_SECRET, rawBody)`, hex in `X-Signature`; verify uses timing-safe compare on the RAW body (register raw-body for the webhook route).
- Mock provider: `src/modules/payments/mock-payment-provider.ts` consumes `PaymentCreated`, schedules (in-process timer, delay from env `MOCK_PAYMENT_DELAY_MS`) a self-call to the webhook with a signed `SUCCEEDED` payload by default. Force endpoints flip the queued outcome.
- Webhook idempotency: Redis `SETNX processed:webhook:{providerEventId}` TTL (provider-supplied id from signed payload) + durable record for money-affecting events; if exists → 200 no-op.
- Compensation reuses `order-status.ts` (CAS transitions, rejects `cancelled→paid`) + inventory release via the shared `src/modules/inventory/adjust-stock.ts` **created in phase 4** (guarded `WHERE stock_reserved >= q`).
- New events: `PaymentCreated, PaymentSucceeded, PaymentFailed, OrderPaid` (+ reuse `OrderCancelled`). Topology bindings updated.

## Related Code Files

- Create: `src/modules/payments/{payments-routes,payments-controller,payments-service,payments-repository,payments-schema,payment-status,webhook-signature,mock-payment-provider}.ts`
- Reuse (created phase 4): `src/modules/inventory/adjust-stock.ts`, `src/modules/orders/order-status.ts`
- Create migration: `drizzle/0006_*.sql` (payments table)
- Modify: `src/infra/db/schema.ts` (payments), `src/infra/mq/outbox-event-types.ts`, `src/infra/mq/topology.ts`, `src/config/env-schema.ts` (MOCK_PAYMENT_DELAY_MS), `src/app.ts` (routes + raw body for webhook)

## TDD — Tests First

1. `test/unit/webhook-signature.test.ts` — valid sig verifies; tampered body/sig fails; timing-safe.
2. `test/integration/payment-saga-success.test.ts` — InventoryReserved → PaymentCreated → webhook SUCCEEDED → order paid, reserved committed (reserved→0, available unchanged), OrderPaid emitted.
3. `test/integration/payment-saga-failure.test.ts` — force fail → webhook FAILED → inventory released (available restored), order cancelled, OrderCancelled emitted.
4. `test/integration/webhook-idempotency.test.ts` — same webhook eventId delivered 3× → payment updated once, one PaymentSucceeded.
5. `test/unit/payment-status.test.ts` — transition guards.

## Implementation Steps

1. `payments` schema + events + topology + env delay; `db:generate`→migrate.
2. Write failing tests.
3. Implement payment module: status machine, repository, service, webhook signature (raw-body route), webhook controller (verify→dedup→update→emit), mock provider consumer + force endpoints.
4. Implement `adjust-stock.ts`; wire PaymentSucceeded (commit reserve+OrderPaid) and PaymentFailed (release+cancel) consumers.
5. typecheck + lint + tests green.

## Success Criteria

- [x] Full happy path: reserved → paid → OrderPaid, reservation committed (reserved decremented).
- [x] Forced failure: inventory released, order cancelled (compensation verified).
- [x] Webhook rejects bad HMAC (401) before side effects; duplicate webhook → single effect.
- [x] All payment/inventory transitions idempotent + status-guarded.
- [x] typecheck + lint + tests green (94/94, 17 new).

## Implementation Notes (delta from spec)

- Migration is `drizzle/0008_*.sql` (next sequential number), not `0006`.
- Raw body captured via a content-type parser SCOPED to the payments plugin (`req.rawBody`),
  not `@fastify/raw-body` — zero new dependency (user choice).
- Durable webhook dedup reuses `processed_messages` (`consumer='webhook'`,
  `eventId=providerEventId`); Redis SETNX is the fast-path in front of it.
- Commit/release items are read from `order_items` (not threaded through payment events).
- Tests drive the webhook directly via `app.inject` with signed payloads (deterministic);
  the mock provider's timer/HTTP self-delivery is a dev convenience (signing unit-tested).
- `order.paid` is emitted but has no bound consumer yet — the shipment consumer binds it in
  phase 7 (topic exchange discards unbound events, by design).

## Risk Assessment

- HMAC over parsed vs raw body mismatch → verify against RAW body (configure raw body only for webhook route).
- Double compensation (release twice) → status guard: only release when order still `pending`/reserved; dedup webhook + outbox eventId.
- In-process timer for mock delay lost on restart → acceptable for portfolio; note as known limitation (a real system would use a scheduled/delayed message).
- Keep each new file <200 LOC (split provider/controller/service).

## Red Team Hardening (Critical/High/Medium — apply in this phase)

- **Auth the mock force-endpoints.** `POST /mock-payments/:id/{succeed,fail}` drive the real saga commit (order→paid, reservation committed, shipment created). They MUST be `requireRole('admin')` (dev/test only) or compiled out in production — otherwise anyone guessing a payment id gets free checkout. Currently unspecified; product CRUD already requires admin, so this is a conspicuous gap.
- **Status compare-and-set; reject `cancelled → paid`.** If `PaymentFailed` cancels first, a following `PaymentSucceeded` (distinct transport id → passes webhook dedup) must NOT flip `cancelled → paid`. Use a conditional UPDATE `... WHERE status = 'pending' RETURNING` for the paid transition (and the same CAS pattern for release/cancel). Zero rows → already terminal, no-op.
- **Guarded stock commit/release.** Commit (`stock_reserved -= q`) and release (`stock_available += q, stock_reserved -= q`) reuse `adjust-stock.ts` with `WHERE stock_reserved >= q RETURNING` (per phase-4 invariant + CHECK constraints). No unguarded arithmetic → no negative reserved, no double-release over-sell.
- **Raw-body plumbing named + byte-fidelity tested.** `app.ts` uses the global JSON parser; HMAC over re-serialized JSON will mismatch. Register `@fastify/raw-body` (or a content-type parser) scoped to the webhook route ONLY, verify HMAC against the exact received bytes, and add a test that signs raw bytes and confirms a re-serialized body would FAIL (proves the test isn't controlling both sides).
- **Webhook replay defense.** Signed payload must include a `timestamp` (and the provider event id); reject requests with skewed/old timestamps before dedup, so a captured valid body cannot be replayed after the Redis dedup TTL expires. Back the dedup with a durable record for money-affecting events, not Redis-TTL alone.
- **Rename webhook dedup key → `providerEventId`.** The envelope `eventId` (outbox uuid) is a different thing from the inbound webhook's id. The webhook dedup key `processed:webhook:{providerEventId}` must use a **provider-supplied** id carried in the signed payload — define its source explicitly so the implementer does not self-generate it (which would defeat idempotency). Reject webhooks missing it.
