---
phase: 9
title: 'Docs Diagrams & Tests'
status: completed
priority: P2
effort: '5h'
dependencies: [7, 8]
---

# Phase 9: Docs Diagrams & Tests

## Overview

Make the architecture legible to a reviewer (the first thing recruiters read): write the docs + Mermaid diagrams, add end-to-end saga integration tests, and update observability (metrics/dashboard) for the new flows.

## Requirements

- Functional: `docs/architecture.md`, `docs/event-flow.md`, `docs/state-machine.md`, `docs/compensation.md` each with ≥1 Mermaid diagram (≥3 total: Order Flow, Saga, Compensation). README updated with new feature set + repo rename note (`order-management-api`).
- Non-functional: at least one full happy-path E2E test and one full compensation E2E test; metrics expose saga counters.

## Architecture

- Docs: keep each <800 LOC (docs.maxLoc). Diagrams via Mermaid v11 syntax.
  - `architecture.md`: component map (API, Outbox relay, RabbitMQ, workers, Redis, Postgres).
  - `event-flow.md`: full event graph happy path (OrderCreated→…→ShipmentDelivered).
  - `state-machine.md`: order + payment + shipment state machines.
  - `compensation.md`: failure paths (out-of-stock, payment-failed, cancel-refund) with restock.
- Tests: `test/integration/e2e-happy-path.test.ts` (place→reserve→pay(webhook)→ship→deliver, assert correlationId consistent across events + final states); `test/integration/e2e-compensation.test.ts` (force fail → released + cancelled).
- Observability: add Prometheus counters (orders_created, inventory_reserved, payments_succeeded/failed, orders_cancelled, shipments_delivered) in `src/plugins/metrics.ts`; optionally a Grafana panel.

## Related Code Files

- Create: `docs/architecture.md`, `docs/event-flow.md`, `docs/state-machine.md`, `docs/compensation.md`, `test/integration/e2e-happy-path.test.ts`, `test/integration/e2e-compensation.test.ts`
- Modify: `README.md`, `src/plugins/metrics.ts`, `grafana/provisioning/dashboards/api-overview.json` (optional panel), `docs/tech-stack.md` (add Redis)

## TDD — Tests First

1. `test/integration/e2e-happy-path.test.ts` — full chain green; correlationId == orderId across all emitted events; final order=delivered, payment=paid, shipment=delivered, stock committed.
2. `test/integration/e2e-compensation.test.ts` — forced payment fail → order cancelled, payment failed, stock fully restored.
3. `test/unit/saga-metrics.test.ts` — counters increment on respective events.

## Implementation Steps

1. Write E2E + metrics tests (failing).
2. Implement saga metric counters.
3. Make E2E pass (fix any wiring gaps surfaced).
4. Write docs + Mermaid diagrams; update README + tech-stack (Redis).
5. `npm run typecheck && npm run lint && npm run test:cov` → green; review coverage of saga/compensation paths.

## Success Criteria

- [x] 4 docs (architecture, event-flow, state-machine, compensation) with 6 Mermaid diagrams.
- [x] E2E happy-path + compensation tests green; correlationId == orderId across every event.
- [x] Saga metrics defined + exposed at `/metrics` (API-side counters scraped; worker-side documented).
- [x] README + tech-stack reflect the saga architecture + Redis.
- [x] Full suite green (116/116).

## Implementation Notes (delta from spec)

- Saga counters live in `src/infra/telemetry/saga-metrics.ts` (prom-client). API-process
  milestones (orders_created, payments_succeeded/failed, orders_cancelled) surface on the
  scraped API `/metrics`; worker-process ones (inventory_reserved, shipments_delivered) count
  in the worker's registry — documented caveat (would need the worker `/metrics` scraped).
- `prom-client` pinned as a direct dependency (was transitive via fastify-metrics).
- E2E tests drive the real handlers + webhook deterministically (no timers) per the plan's
  flakiness mitigation; broker publish/consume remains covered by `order-flow.test.ts`.
- Counter-delta assertions added to both E2E tests so the increment call-sites are verified
  (not just the prom-client library).
- Mermaid diagrams use `<br/>` line breaks (v11 flowchart labels don't honor `\n`).

## Risk Assessment

- E2E flakiness from timers (mock payment delay, shipping steps) → make delays configurable to near-0 in tests; drive workers deterministically (expose tick like the outbox relay).
- Docs drifting from code → write docs LAST (after behavior is final).
- Keep docs within docs.maxLoc (800).
