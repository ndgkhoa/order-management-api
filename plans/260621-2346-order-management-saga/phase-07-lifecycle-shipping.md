---
phase: 7
title: 'Lifecycle & Shipping'
status: completed
priority: P2
effort: '6h'
dependencies: [6]
---

# Phase 7: Lifecycle & Shipping

## Overview

Complete the order lifecycle: on `OrderPaid` create a shipment and drive it through a fake shipping worker (`pending → ready_for_pickup → in_transit → delivered`), each step emitting an event. Add an order status-history audit, admin manual controls, and customer pre-ship cancellation with refund (mock).

## Requirements

- Functional:
  - `OrderPaid` → create `shipments(pending)` → emit `ShipmentCreated`.
  - Fake shipping worker advances status on a timer, emitting `ShipmentReadyForPickup/InTransit/Delivered`; final `Delivered` sets order `delivered`.
  - `order_status_history` row written on every order transition.
  - Admin: `PATCH /shipments/:id/status` manual advance; `GET /orders` (all).
  - Customer: `POST /orders/:id/cancel` allowed only pre-ship → release any committed stock? (paid orders already shipped-out stock; cancel-after-paid triggers mock refund + restock) — guard by current status.
- Non-functional: illegal transitions rejected by the central guard; every transition idempotent; correlationId preserved.

## Architecture

- Schema: `shipments` (`id, order_id, status, carrier, tracking_no, created_at, updated_at`); `order_status_history` (`id, order_id, from_status, to_status, reason, created_at`).
- Extend `order-status.ts` machine: `paid → fulfilling → delivered`, `paid → cancelled` (refund), `pending → cancelled`. Shipping statuses in `shipment-status.ts`.
- `src/modules/shipping/fake-shipping-worker.ts` — consumes `OrderPaid`, schedules timed advances (env `SHIPPING_STEP_MS`), emits shipment events; updates order to `fulfilling` then `delivered`.
- Refund on cancel-after-paid: mark payment `refunded` + restock (`stock_available += q`) + `OrderCancelled`/`OrderRefunded` event + notify. Pre-ship only (status guard).
- New events: `ShipmentCreated, ShipmentReadyForPickup, ShipmentInTransit, ShipmentDelivered, OrderRefunded`.

## Related Code Files

- Create: `src/modules/shipping/{shipments-routes,shipments-controller,shipments-service,shipments-repository,shipment-status,fake-shipping-worker}.ts`, `src/modules/orders/order-status-history.ts`
- Create migration: `drizzle/0007_*.sql` (shipments, order_status_history)
- Modify: `src/modules/orders/order-status.ts` (transitions), `src/modules/orders/orders-routes.ts` (cancel endpoint), `src/infra/mq/outbox-event-types.ts`, `src/infra/mq/topology.ts`, `src/config/env-schema.ts` (SHIPPING_STEP_MS)

## TDD — Tests First

1. `test/unit/shipment-status.test.ts` — legal/illegal shipment transitions.
2. `test/integration/shipping-flow.test.ts` — OrderPaid → shipment created → advances to delivered; order ends `delivered`; status-history rows recorded per transition.
3. `test/integration/cancel-refund.test.ts` — cancel paid pre-ship → payment refunded + stock restocked + OrderRefunded; cancel after shipped → rejected.
4. `test/unit/order-status-history.test.ts` — every transition logs from→to.

## Implementation Steps

1. Schemas + events + topology + env step; `db:generate`→migrate.
2. Write failing tests.
3. Implement shipment status machine, repository/service, fake shipping worker (timed advances), status-history writer, admin manual endpoint, customer cancel/refund endpoint.
4. Wire OrderPaid consumer → create shipment.
5. typecheck + lint + tests green.

## Success Criteria

- [x] OrderPaid → shipment auto-advances pending→ready_for_pickup→in_transit→delivered, each emitting an event.
- [x] Order ends `delivered`; status-history captures every transition.
- [x] Admin manual status update works; customer cancel allowed only pre-ship.
- [x] Cancel-after-paid (pre-ship) → mock refund + restock + event.
- [x] typecheck + lint + tests green (104/104, 10 new).

## Implementation Notes (delta from spec)

- Migration is `drizzle/0009_*.sql` (next sequential), not `0007`.
- `order-status.ts` needed NO change — the machine already covered paid→fulfilling→delivered
  and the cancel edges.
- Shipment creation is gated on WINNING the order CAS `paid→fulfilling` first (acquires the
  order row lock) so a concurrent cancel serializes behind and loses — no orphaned shipment
  for a cancelled/refunded order.
- Admin manual advance `PATCH /shipments/:id/status` reuses `advanceShipment` (same CAS +
  machine) and is the manual recovery path for a shipment stranded by a lost in-process timer.
- Full history coverage: `recordOrderTransition` added at create (null→pending) and every
  transition point incl. the phase-4/6 consumers (out-of-stock, payment paid, payment-failed).
- `shipment.*` and `order.refunded` are emitted but have no bound consumer yet — phase 8
  (notifications) binds them (topic exchange discards unrouted events, by design).

## Risk Assessment

- Race: cancel vs shipping-advance → status guard + check-and-set on current status (reject if already shipped).
- Restock correctness on refund → mirror reserve/release helper; idempotent.
- Timer-driven worker non-durable on restart → acceptable for portfolio; document limitation.

## Red Team Hardening (High/Medium — apply in this phase)

- **Cancel ownership (IDOR).** `POST /orders/:id/cancel` MUST assert the order belongs to `request.user.sub` (customer path) before any state change. Admins bypass via `requireRole('admin')`. Without the ownership check any authenticated user can cancel/refund another user's order.
- **Cancel vs shipping-advance is TOCTOU.** The HTTP cancel handler and the timer-driven shipping worker (separate execution contexts) both mutate `orders.status`. Use a conditional UPDATE (compare-and-set on current status) — never read-then-write — so cancel is rejected the instant a shipment has advanced, preventing refund+restock AND ship.
- **Admin manual override must share the guard.** If `PATCH /shipments/:id/status` is kept, it must go through the same status machine + CAS as the worker (it is a second writer). If not needed for the demo, cut it — RBAC is already exercised by admin product CRUD and admin `GET /orders`.
- **Lost-timer recovery.** Given the relay/worker fixes (phase 1), an order stuck after a lost mock-payment/shipping timer should be recoverable via the admin force/advance path — note this as the manual recovery story rather than leaving stock leaked indefinitely.
