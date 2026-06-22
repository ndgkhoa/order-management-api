---
phase: 9
title: 'Docs Diagrams & Tests'
status: pending
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

- [ ] 4 docs with ≥3 Mermaid diagrams (Order Flow, Saga, Compensation).
- [ ] E2E happy-path + compensation tests green; correlationId consistent across events.
- [ ] Saga metrics exposed at `/metrics`.
- [ ] README + tech-stack reflect new architecture + Redis.
- [ ] Full suite + coverage green.

## Risk Assessment

- E2E flakiness from timers (mock payment delay, shipping steps) → make delays configurable to near-0 in tests; drive workers deterministically (expose tick like the outbox relay).
- Docs drifting from code → write docs LAST (after behavior is final).
- Keep docs within docs.maxLoc (800).
