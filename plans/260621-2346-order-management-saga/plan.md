---
title: 'Order Management API — Event-Driven Saga (Catalog, Inventory, Payment, Shipping)'
description: 'Evolve the Fastify+Drizzle+RabbitMQ outbox skeleton into an e-commerce order backend showcasing event-driven choreography saga, idempotency (API/webhook/consumer), inventory reservation + compensation, and HMAC webhook integration.'
status: pending
priority: P2
effort: ~50h (9 phases)
branch: develop
tags:
  [fastify, drizzle, rabbitmq, outbox, saga, choreography, redis, idempotency, webhook, e-commerce]
created: 2026-06-21
mode: tdd
source: plans/reports/brainstorm-order-management-260621-2346-event-driven-saga-design-report.md
---

# Order Management API — Event-Driven Saga

Goal: portfolio-grade backend demonstrating **Transactional Outbox + Event-Driven choreography + Idempotency + Saga compensation + Webhook integration**. Builds on the completed foundation (auth, orders, outbox relay, email worker, observability) in `plans/260610-0946-fastify-drizzle-order-api/`. Stack is LOCKED (see `docs/tech-stack.md`); this plan only adds Redis.

## Core saga (the point)

```
POST /orders ─TX→ order(pending)+items+outbox(OrderCreated) → 201 pending
  [OrderCreated]  → reserve (available-=q, reserved+=q)  ├ ok→InventoryReserved  └ fail→order.cancelled
  [InventoryReserved] → payment(pending)+PaymentCreated
  [PaymentCreated]    → MockProvider →(delay)→ POST /webhooks/payment  (HMAC verify + Redis dedup)
                         → PaymentSucceeded | PaymentFailed
  [PaymentSucceeded]  → order→paid, reserved-=q (commit) + OrderPaid + shipment(pending) + notify
  [PaymentFailed]     → COMPENSATE: available+=q, reserved-=q + order→cancelled + notify
  [OrderPaid] → shipping worker: pending→ready_for_pickup→in_transit→delivered (event+notify each)
```

`correlation_id = order_id` on every event + log line.

## Phases

| Phase | Name                                                                   | Status       |
| ----- | ---------------------------------------------------------------------- | ------------ |
| 1     | [Foundation & Event Envelope](./phase-01-foundation-event-envelope.md) | ✅ Completed |
| 2     | [Product Catalog & Cache](./phase-02-product-catalog-cache.md)         | ✅ Completed |
| 3     | [Order Aggregate Refactor](./phase-03-order-aggregate-refactor.md)     | ✅ Completed |
| 4     | [Inventory Reservation Saga](./phase-04-inventory-reservation-saga.md) | ✅ Completed |
| 5     | [Idempotency & Rate-Limit](./phase-05-idempotency-rate-limit.md)       | ✅ Completed |
| 6     | [Payment Saga & Webhook](./phase-06-payment-saga-webhook.md)           | ✅ Completed |
| 7     | [Lifecycle & Shipping](./phase-07-lifecycle-shipping.md)               | Pending      |
| 8     | [Notifications](./phase-08-notifications.md)                           | Pending      |
| 9     | [Docs Diagrams & Tests](./phase-09-docs-diagrams-tests.md)             | Pending      |

## Build order & dependencies

- 1 → 2 → 3 → 4 → 6 are the critical path (envelope → catalog → order shape → reserve → pay).
- 5 (idempotency) depends on 3 (POST /orders exists). 7 depends on 6 (OrderPaid). 8 depends on events from 4/6/7. 9 last.
- Each phase is TDD: write failing tests first, then implement to green.

## Key decisions (locked, from brainstorm)

- Inventory: Postgres atomic `UPDATE ... WHERE stock_available>=qty` (NO Redis distributed lock).
- Payment: simulated mock provider → async webhook w/ HMAC `X-Signature` + Redis dedup; `POST /mock-payments/:id/{succeed,fail}` to force scenarios.
- Redis: idempotency-key store, webhook dedup, catalog cache, rate-limit backend.
- Notifications: `NotificationProvider` interface, `EmailProvider` real, `SmsProvider` TODO stub.
- Out-of-stock is async (`201 pending` → later `order.cancelled`); client polls `GET /orders/:id`.

## Dependencies

- Builds on (already implemented in code): `project:260610-0946-fastify-drizzle-order-api` (foundation — complete in code).
- New infra: Redis (docker-compose service + `ioredis` plugin — `ioredis` is NOT yet in package.json; phase 1 adds it).

## Red Team Review

### Session — 2026-06-22

**Findings:** 15 (15 accepted, 17 rejected/deduped from 32 raw)
**Severity breakdown:** 3 Critical, 9 High, 3 Medium
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic (all lenses, Full tier). Reports in `./reports/`.
**Focus:** saga compensation, webhook HMAC, idempotency, over-sell, RBAC (per request).

| #   | Finding                                                                                            | Severity | Disposition | Applied To    |
| --- | -------------------------------------------------------------------------------------------------- | -------- | ----------- | ------------- |
| 1   | Dedup keyed on outbox row id, single global col → fan-out cannibalization + no logical-event dedup | Critical | Accept      | Phase 1       |
| 2   | Relay runs only in API process; workers emit but never publish; no reaper                          | Critical | Accept      | Phase 1 (4/6) |
| 3   | Mock force-endpoints unauthenticated → free checkout                                               | Critical | Accept      | Phase 6       |
| 4   | `ioredis` not installed; no phase adds it                                                          | High     | Accept      | Phase 1       |
| 5   | Topology underspecifies queue-per-consumer (competing vs fan-out)                                  | High     | Accept      | Phase 1       |
| 6   | No CAS on status; `cancelled→paid` allowed; cancel-vs-ship TOCTOU                                  | High     | Accept      | Phase 6/7     |
| 7   | Stock commit/release unguarded; no CHECK → negative reserved/over-sell                             | High     | Accept      | Phase 4/6     |
| 8   | Webhook raw-body plumbing absent → HMAC mismatch in prod                                           | High     | Accept      | Phase 6       |
| 9   | Webhook replay after Redis dedup TTL (no timestamp/nonce)                                          | High     | Accept      | Phase 6       |
| 10  | Idempotency poison marker (self-DoS) + caches errors + no owner re-check                           | High     | Accept      | Phase 5       |
| 11  | RBAC under-specified; no DB re-check; cancel IDOR                                                  | High     | Accept      | Phase 1/7     |
| 12  | Order status machine defined 3× inconsistently; `created`→`pending` rename                         | High     | Accept      | Phase 3       |
| 13  | `WEBHOOK_HMAC_SECRET` no minLength                                                                 | Medium   | Accept      | Phase 1       |
| 14  | `eventId` collision — webhook needs provider-supplied id                                           | Medium   | Accept      | Phase 6       |
| 15  | `InventoryReserved` payload item shape unpinned                                                    | Medium   | Accept      | Phase 4       |

**Conflict resolved:** Scope critic's "drop the new `event_id` column as redundant" was **rejected** — findings 1 proves the outbox row id is insufficient for logical-event/fan-out dedup; the correct fix is a composite (`consumer_name`, logical `event_id`) key, so `event_id` is kept. `correlation_id` retained.

**Optional cuts (NOT applied — owner's call):** per-route idempotency config abstraction → just `POST /orders`; `order_status_history` table → log line; admin `PATCH /shipments/:id/status` → cut (or share worker CAS).

### Whole-Plan Consistency Sweep

Re-read `plan.md` + all 9 phase files after applying findings. Reconciled 3 stale contradictions introduced by the deltas:

- Phase 1 Architecture: replaced the old single-key dedup description (`keep message_id ... OR add event_id`) with the composite `(consumer_name, event_id)` PK.
- Phase 6: `eventId` → `providerEventId` for webhook dedup (2 spots); added timestamp + durable backstop.
- Phase 6 Related Code Files: `adjust-stock.ts` / `order-status.ts` moved from **Create** to **Reuse (created phase 4)**.
- plan.md Dependencies: noted `ioredis` not yet installed (phase 1 adds it).

No unresolved contradictions remain. Plan is internally consistent and ready for implementation.
