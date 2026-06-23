# Brainstorm Summary — `order-management-api` (Event-Driven Saga)

Date: 2026-06-21 · Branch: develop · Status: approved → plan (TDD)

## Problem statement

Evolve existing `fastify-drizzle` skeleton (Fastify v5 + Drizzle/PG + RabbitMQ + Transactional Outbox) into an **e-commerce / order management backend** as a **portfolio piece** that showcases: Transactional Outbox, Event-Driven choreography, Idempotency (API + webhook + consumer), Saga + Compensation, Integration patterns (webhook + HMAC). Repo name: `order-management-api`.

## Locked decisions (from discovery)

- Goal: portfolio/showcase patterns (payment & SMS simulated).
- Domain: product catalog + multi-line orders + inventory **reservation**.
- Inventory concurrency: **Postgres atomic UPDATE** (no Redis distributed lock — ACID is enough; Redlock = over-engineering here).
- Payment: **simulated** — mock provider → async **webhook** w/ HMAC signature; mock endpoints to force succeed/fail.
- RBAC: `customer` / `admin`.
- Redis roles: **Idempotency-Key store**, **webhook dedup**, **catalog cache**, **rate-limit backend**. (No distributed lock.)
- Order lifecycle: full state machine + fake shipping worker.
- Notifications: `NotificationProvider` interface, `EmailProvider` real, `SmsProvider` TODO stub.

## Key design upgrades (vs initial draft)

1. `products.stock` → **`stock_available` + `stock_reserved`** (true reservation; natural compensation).
2. Inventory reserve split into its own event `InventoryReserved` (choreography, not orchestration-in-one-TX).
3. Payment removed from order-create TX. Order = primary aggregate; payment is downstream, created from `InventoryReserved`.
   - **Consequence (accepted):** out-of-stock is now **async** → `InventoryReservationFailed` → `order.cancelled` (not a sync 409). `POST /orders` returns `201 pending`; client polls `GET /orders/:id`.
4. Standard **event envelope**: `{ eventId, eventType, correlationId, occurredAt, payload }`. Consumer dedup keyed on `event_id`.
5. Shipment statuses: `pending → ready_for_pickup → in_transit → delivered`.
6. **`correlation_id = order_id`** on every event + structured log line (business-level, complements existing request correlation-id + W3C trace context).
7. Notifications: provider abstraction, email real, sms TODO.
8. Docs + diagrams are first-class deliverables (`docs/architecture.md`, `event-flow.md`, `state-machine.md`, `compensation.md`, ≥3 Mermaid).

## Final event graph (choreography saga)

```
POST /orders (Idempotency-Key)
  TX: order(pending) + order_items(price snapshot) + outbox(OrderCreated)  COMMIT → 201 pending

[OrderCreated]  reserve: available-=qty, reserved+=qty  (atomic, WHERE available>=qty)
                 ├─ ok   → InventoryReserved
                 └─ fail → InventoryReservationFailed → order.cancelled + notify(out-of-stock)

[InventoryReserved]  → payment(pending) + PaymentCreated

[PaymentCreated]     → Mock Provider (after delay) → POST /webhooks/payment
                         Webhook: verify HMAC(X-Signature) → Redis dedup(processed:webhook:eventId)
                                  → update payment → outbox(PaymentSucceeded | PaymentFailed)

[PaymentSucceeded]   → order→paid, reserved-=qty (commit) + OrderPaid + shipment(pending) + notify

[PaymentFailed]      → COMPENSATE: available+=qty, reserved-=qty + order→cancelled + OrderCancelled + notify

[OrderPaid] → fake shipping worker: pending→ready_for_pickup→in_transit→delivered (each: event + notify)
```

Mock provider control endpoints: `POST /mock-payments/:id/succeed`, `POST /mock-payments/:id/fail`.
`correlation_id = order_id` propagated through all events + logs.

## Schema (changes)

- `products`: `id, sku(unique), name, description, price_cents, stock_available, stock_reserved, active, ts`
- `orders`: `id, user_id, status, total_cents, currency, ts` (status: pending→paid→fulfilling→delivered / cancelled)
- `order_items`: `id, order_id, product_id, sku_snapshot, unit_price_cents, quantity, line_total_cents`
- `payments`: `id, order_id, status(pending|paid|failed|refunded), amount_cents, provider, provider_ref, ts`
- `shipments`: `id, order_id, status(pending|ready_for_pickup|in_transit|delivered), carrier, tracking_no, ts`
- `order_status_history`: `id, order_id, from_status, to_status, reason, created_at`
- `outbox_messages`: **+ `event_id`, + `correlation_id`** (keep aggregate/payload/trace_context/published_at)
- `processed_messages`: dedup keyed on `event_id`
- `users`: **+ `role`** (default `customer`)

## Redis (3 concrete roles, no lock)

- Idempotency-Key hook for `POST /orders` (+ any mutating POST).
- Webhook dedup: `processed:webhook:{eventId}`.
- Catalog cache (list/detail) w/ invalidation on admin write.
- Rate-limit backend (`@fastify/rate-limit` → Redis) for multi-instance.

## RBAC

- customer: place order, view/cancel own (pre-ship).
- admin: CRUD products, view all orders, manual shipment status, refund.
- Guard: role decorator on JWT payload.

## Phases (9) — TDD

1. Foundation & event envelope — Redis infra (ioredis plugin) + env, `role`+RBAC guard, envelope (`event_id`/`correlation_id`/`occurredAt`), migrate outbox + dedup→event_id.
2. Catalog — `products` (available/reserved) + admin CRUD + public list/detail + Redis cache.
3. Order aggregate refactor — `order_items`, multi-line orders, create TX = order+items+outbox(OrderCreated) only.
4. Inventory saga — OrderCreated→reserve→InventoryReserved / Failed→compensation cancel.
5. Idempotency & rate-limit — Redis idempotency hook + rate-limit backend.
6. Payment saga (mock + webhook) — payments, InventoryReserved→PaymentCreated, mock provider→webhook(HMAC+dedup)→Succeeded/Failed→OrderPaid / release+cancel.
7. Lifecycle & shipping — status state machine + history, shipments (4 states), fake shipping worker, admin endpoints, cancel/refund pre-ship.
8. Notifications — `NotificationProvider` + `EmailProvider` (real) + `SmsProvider` (TODO), route by event_type, templates.
9. Docs & diagrams & tests — architecture/event-flow/state-machine/compensation.md + Mermaid; integration tests for saga + compensation; metrics/dashboard.

## Risks

- Async out-of-stock: must expose `GET /orders/:id` for status polling; document the eventual-consistency tradeoff.
- Saga idempotency: every consumer idempotent + status-guarded (avoid double-release / re-process on redelivery).
- Phase 3 breaks existing orders API/tests → TDD locks behavior first.
- Webhook security: HMAC verify even though mock (mirror Stripe pattern); reject bad signature before any side effect.
- File size rule (<200 LOC): split payment/shipping/notification modules.

## Success criteria

- Place multi-item order → reserve → mock pay (webhook) → paid → shipped → delivered, all events share `correlation_id`.
- Force-fail payment → inventory released, order cancelled (compensation verified by test).
- Duplicate webhook delivery → single side effect (idempotent).
- Out-of-stock order → async cancellation.
- Admin manages catalog; RBAC blocks customer from admin endpoints.
- Docs render 3+ diagrams; integration tests green.

## Open questions

- Refund scope: pre-ship cancel only, or also post-delivered refund? (assumed pre-ship cancel + mock refund this round)
- Currency: single currency assumed (e.g. cents/VND or USD)? confirm during plan.
- Mock provider delay mechanism: in-process timer vs scheduled message? (assume in-process timer in mock-payment worker)
