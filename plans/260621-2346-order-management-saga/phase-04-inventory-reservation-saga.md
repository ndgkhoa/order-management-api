---
phase: 4
title: 'Inventory Reservation Saga'
status: completed
priority: P1
effort: '6h'
dependencies: [3]
---

# Phase 4: Inventory Reservation Saga

## Overview

First saga step: an `OrderCreated` consumer reserves stock atomically (`stock_available -= q`, `stock_reserved += q`). Success emits `InventoryReserved`; insufficient stock emits the compensation path → `order.cancelled`.

## Requirements

- Functional: consume `OrderCreated`; for each item run guarded atomic update; if ALL succeed → mark reserved + emit `InventoryReserved`; if ANY fails → roll back the whole order's reservations + set order `cancelled` + emit `OrderCancelled` (reason `out_of_stock`).
- Non-functional: idempotent (redelivery of same `eventId` → no double reserve, via processed_messages dedup); all-or-nothing per order (one tx); correlationId carried forward.

## Architecture

- Atomic reserve (per item, same tx): `UPDATE products SET stock_available = stock_available - q, stock_reserved = stock_reserved + q WHERE id = ? AND stock_available >= q RETURNING id`. Zero rows → insufficient → abort tx, take compensation branch.
- Handler: `src/modules/orders/order-created-handler.ts` extended (or new `src/modules/inventory/reserve-on-order-created.ts`) — wraps reserve + dedup insert + outbox emit in ONE db tx (transactional outbox again: reserve and the next event commit together).
- New events in `outbox-event-types.ts`: `InventoryReserved { orderId, items }`, `OrderCancelled { orderId, reason }`. Wire consumer bindings/routing keys in `topology.ts`.
- Order status transition helper introduced here (shared, reused phase 6/7): `pending → cancelled` (out_of_stock). Keep transition guards centralized: `src/modules/orders/order-status.ts`.

## Related Code Files

- Create: `src/modules/inventory/reserve-on-order-created.ts`, `src/modules/orders/order-status.ts`
- Modify: `src/infra/mq/outbox-event-types.ts`, `src/infra/mq/topology.ts` (routing keys/bindings), `src/workers/email-worker.ts` or new consumer wiring, `src/infra/db/schema.ts` (no change unless adding cancel reason to orders — add `cancel_reason text` nullable)
- Create migration: `drizzle/0005_*.sql` (cancel_reason)

## TDD — Tests First

1. `test/unit/reserve-inventory.test.ts` — sufficient stock → available/reserved updated correctly; insufficient → no mutation, returns failure.
2. `test/integration/inventory-saga.test.ts` — OrderCreated event → InventoryReserved emitted + stock moved; out-of-stock order → OrderCancelled emitted + stock untouched + order.status=cancelled.
3. `test/unit/order-status.test.ts` — transition guard allows pending→cancelled, rejects illegal transitions.
4. Idempotency: redeliver same OrderCreated eventId → reserve runs once (dedup), stock unchanged on 2nd.

## Implementation Steps

1. Add events + topology bindings; add `cancel_reason` column.
2. Write failing tests.
3. Implement `order-status.ts` guard; implement reserve handler (atomic update + dedup + outbox emit in one tx).
4. Wire consumer to `OrderCreated` routing key.
5. typecheck + lint + tests green.

## Success Criteria

- [ ] OrderCreated → atomic reserve → InventoryReserved on success.
- [ ] Insufficient stock → order cancelled (out_of_stock) + stock untouched, no partial reservation.
- [ ] Reserve handler idempotent on redelivery.
- [ ] No over-sell under concurrent orders (atomic UPDATE guarantees).
- [ ] typecheck + lint + tests green.

## Risk Assessment

- Partial reservation on multi-item failure → wrap all items in ONE tx; any failure rolls back all.
- Double-reserve on redelivery → processed_messages dedup on eventId before/within tx.
- Concurrency: rely on Postgres row update atomicity (`WHERE stock_available >= q`); NO Redis lock (verified ACID is sufficient).

## Red Team Hardening (High/Medium — apply in this phase)

- **Relay-in-worker + stuck-order reaper (moved here from Phase 1).** This is the first phase where a worker emits outbox events (the inventory consumer writes `InventoryReserved`/`OrderCancelled` via the transactional outbox). The outbox relay currently starts only in the API process (`src/server.ts`); wire `createOutboxRelay` into the worker process too (or run a dedicated relay process) so consumer-emitted events actually publish. Add a stuck-order reaper: sweep `pending` orders older than N minutes → log/alert/manual-recovery path, so a lost in-process timer never strands an order with reserved stock indefinitely.
- **Guard EVERY stock mutation + DB CHECK constraints.** Reserve is guarded (`WHERE stock_available >= q`) but the commit/release UPDATEs (phase 6) are not. Establish the invariant here: add CHECK constraints `stock_available >= 0` and `stock_reserved >= 0` in the migration, and require every release/commit to use `WHERE stock_reserved >= q ... RETURNING` (zero rows → guard fail, do not proceed). Prevents negative `stock_reserved` / phantom restock / over-sell.
- **Create the shared stock helper here, at first use.** Reserve logic must live in `src/modules/inventory/adjust-stock.ts` from this phase (not introduced later in phase 6). Phase 6 commit/release reuse the SAME helper — one implementation of the column arithmetic, no divergent copy.
- **Pin the `InventoryReserved` payload item shape.** Emit `InventoryReserved { orderId, items: [{ productId, quantity }] }` (same item shape as `OrderCreated`) so the phase-6 per-item commit/release does not re-query the order. Lock this in `outbox-event-types.ts`.
- **Composite dedup.** This consumer dedups on (`consumer_name`='inventory', logical `event_id`) per the phase-1 hardening — so it does not collide with the email consumer on the same `OrderCreated`.

## Implementation Notes (done 2026-07-02)

- **Worker consolidation:** `email-worker.ts` → generic `src/workers/worker.ts` running BOTH the email and inventory consumers (separate channels) + the outbox relay + the reaper. Renamed everywhere (compose service `email-worker`→`worker`, container `order-management-worker`, package scripts, OTEL name, deployment-guide). Standard "one generic worker hosts all consumers" pattern.
- **All-or-nothing reserve:** the reserve loop runs inside a Postgres SAVEPOINT (`tx.transaction`); a short line throws → savepoint rolls back the partial reserves while the dedup insert + cancel writes stay in the outer tx. Verified by the out-of-stock integration test (sufficient line rolls back to `[10,0]`).
- **Shared guard:** `inventory/adjust-stock.ts` `reserveStock` (guarded `WHERE stock_available >= q RETURNING`) is the sole arithmetic path; phase 6 adds commit/release to the same file. Non-negative CHECKs (from phase 2) are the last line of defence.
- **Status machine:** `orders/order-status.ts` locks the canonical transition table (rejects `cancelled → paid`). Reserve cancel uses CAS `WHERE status='pending'`; wire `assertTransition` into write paths in phases 5/6.
- **Fan-out topology:** `order.created.email` and `order.created.inventory` each bind `order.created` (independent subscribers, not competing) — each with its own DLQ.
- **Relay-in-worker + reaper (red-team):** worker runs `createOutboxRelay` (two relays API+worker, safe via `FOR UPDATE SKIP LOCKED`) + `createOrderReaper` (log-only sweep of stuck `pending` orders; env `ORDER_REAPER_INTERVAL_MS`/`STUCK_ORDER_THRESHOLD_MS`).
- **Review fixes:** `order.cancelled` emitted only when the CAS cancels a row (no spurious cancel for already-terminal orders); deployment-guide entrypoint updated to `worker.js`.
- **Migration 0007:** `orders.cancel_reason text` nullable.
- **Tests:** +9 — order-status unit, reserveStock unit (suffic/insuffic/boundary), inventory-saga integration (success / out_of_stock all-or-nothing / idempotency). Full suite 67 green.
