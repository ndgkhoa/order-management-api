---
phase: 3
title: 'Order Aggregate Refactor'
status: completed
priority: P1
effort: '7h'
dependencies: [2]
---

# Phase 3: Order Aggregate Refactor

## Overview

Reshape `orders` from a single-product row into a multi-line aggregate (`order_items` with price snapshots). The create transaction now writes ONLY order + items + `OrderCreated` outbox — NO stock deduction, NO payment (those move to async saga in phases 4/6).

## Requirements

- Functional: `POST /orders` accepts `{ items: [{ productId, quantity }] }`, snapshots current product price, computes `total_cents`, persists `order(pending)` + `order_items` + outbox(`OrderCreated`) in ONE tx, returns `201 pending`. `GET /orders/:id` + `GET /orders` (own) for status polling.
- Non-functional: price snapshot immutable on the item; reject unknown/inactive product or qty<1 synchronously (cheap validation) but DO NOT reserve stock here.

## Architecture

- Schema: `orders` → `id, user_id, status text default 'pending', total_cents int, currency text default 'USD', created_at, updated_at` (drop `product/quantity/amount`). `order_items` → `id, order_id fk, product_id fk, sku_snapshot, unit_price_cents, quantity, line_total_cents`.
- Status enum (string, guarded in code): `pending → paid → fulfilling → delivered`, plus `cancelled`. Only `pending` set here.
- `OrderCreated` payload: `{ orderId, userId, items:[{productId, sku, unitPriceCents, quantity}], totalCents }`; envelope `correlationId = orderId`.
- `createWithOutbox` rewritten: validate products (exist+active), snapshot prices, insert order+items+outbox in tx. Keep the existing W3C trace-context capture.

## Related Code Files

- Create migration: `drizzle/0004_*.sql`; Create: snapshot/total helper in `orders-service.ts`
- Modify: `src/infra/db/schema.ts` (orders reshape + order_items), `src/modules/orders/{orders-repository,orders-service,orders-schema,orders-controller,orders-routes}.ts`, `src/infra/mq/outbox-event-types.ts` (new OrderCreated payload), `src/modules/orders/order-created-handler.ts` (consumer payload shape — reserve logic added in phase 4)
- Update tests: `test/api/orders.test.ts`, `test/integration/order-flow.test.ts` (new shape)

## TDD — Tests First

1. Rewrite `test/api/orders.test.ts` — multi-item create → 201 pending, total = sum(line totals), items persisted with snapshot price; unknown product → 400; qty<1 → 400; GET own orders + GET :id.
2. `test/unit/order-total.test.ts` — total/line computation from snapshots.
3. Update `test/integration/order-flow.test.ts` — assert tx writes order+items+OrderCreated, NO stock change, NO payment row.

## Implementation Steps

1. Schema reshape + `order_items`; `db:generate` → review (data migration: legacy orders — acceptable to drop in dev) → `db:migrate`.
2. Update failing tests to the new shape.
3. Rewrite `orders-schema` (CreateOrderBody = items[]), service (snapshot+total), repository (`createWithOutbox` multi-line, OrderCreated envelope), controller, routes (+ `GET /orders/:id`).
4. Update `outbox-event-types.ts` OrderCreated payload; adjust `order-created-handler` to new payload (still email-only until phase 4 adds reserve).
5. typecheck + lint + tests green.

## Success Criteria

- [ ] `orders` multi-line; `order_items` with immutable price snapshot.
- [ ] `POST /orders` writes order+items+OrderCreated in one tx; returns 201 pending; no stock/payment side effects.
- [ ] `GET /orders/:id` + list own work for polling.
- [ ] Sync validation rejects bad product/qty; out-of-stock NOT checked here.
- [ ] typecheck + lint + tests green.

## Risk Assessment

- Breaking change to public orders API + existing tests → TDD rewrite locks new contract first (this is why `--tdd`).
- Resist re-adding stock deduction in create tx (the whole point is moving it async) → reviewer must reject any `stock--` here.
- Legacy data: dev DB reset acceptable; note in migration that prod would need a backfill (out of scope).

## Red Team Hardening (High — apply in this phase)

- **Lock the canonical order status machine ONCE here.** The transition table is currently described inconsistently across phases 3/4/7. Define the full set in this phase (table below) as the single source of truth; `order-status.ts` (created phase 4) implements it complete, not incrementally. Also: current schema default is `'created'` (`schema.ts`, `test/api/orders.test.ts`) — this phase renames it to `'pending'`; call that out as a breaking change in the migration + tests.

  | From         | To           | Trigger                       |
  | ------------ | ------------ | ----------------------------- |
  | `pending`    | `paid`       | PaymentSucceeded              |
  | `pending`    | `cancelled`  | out_of_stock / pre-pay cancel |
  | `paid`       | `fulfilling` | shipment advancing            |
  | `paid`       | `cancelled`  | pre-ship cancel (refund)      |
  | `fulfilling` | `delivered`  | ShipmentDelivered             |

  All other transitions illegal. `cancelled`/`delivered` are terminal — explicitly reject `cancelled → paid`.

## Implementation Notes (done 2026-07-02)

- **Decisions:** `OrderCreatedPayload` keeps `email` (worker stays query-free) + `items[]` + `totalCents`; two DTOs (`OrderPublic` summary for list, `OrderDetail` with items for create/`GET :id`); `GET /orders/:id` is owner-scoped → 404 on non-owner (closes the IDOR the phase-7 hardening flagged; admin-all-orders stays phase 7).
- **Layering:** pure `order-total.ts` (unit-tested) computes line snapshots + total; `orders-service` validates each product is active (`findActiveById`, 400 on unknown/inactive) and snapshots price; `orders-repository.createWithOutbox` does the atomic order+items+outbox write. NO stock reserve / payment here.
- **Status machine:** canonical table above locked here; column default `created`→`pending` (breaking, reflected in tests + migration).
- **Migrations:** `0005` reshape (drops product/quantity/amount, adds total_cents/currency/updated_at, creates order_items; `DELETE FROM orders` clears legacy dev rows per plan); `0006` adds indexes on `order_items.order_id/product_id` + `orders.user_id`.
- **Hardening from review:** FK-column indexes (0006); `quantity` max 10000 + `items` maxItems 100 to keep totals within int32 and cap order blast radius (400 not 500).
- **Tests:** 8 added/updated — multi-item create, snapshot immutability, unknown/inactive/qty<1/empty/qty-over-max → 400, list + detail, IDOR 404, pure total helper; order-flow + handler updated to the new payload. Full suite 53 green.
