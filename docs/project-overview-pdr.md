# Project Overview & Product Development Requirements

## Problem Statement

Building production e-commerce order systems requires handling multiple critical concerns simultaneously:

- **State consistency** — orders, payments, and inventory must stay in sync even during failures
- **Asynchronous operations** — payment webhooks and email notifications can't block the API response
- **Fault tolerance** — transient broker/network failures must not lose events or leave orders in inconsistent states
- **Observability** — tracing order progression across async boundaries is non-trivial
- **Idempotency** — client retries and message redelivery must be safe

A naive approach (write to DB, then call external service) creates a dual-write consistency gap. This project demonstrates the Transactional Outbox pattern and choreography saga as a production-grade solution.

## Business Goals

1. **Learning reference** — show how senior backend systems handle async, reliability, and observability
2. **Production foundation** — deployable on day one to Fly.io, VPS, or Kubernetes with real payment/notification providers
3. **Testable architecture** — every critical path tested against real infrastructure (Postgres, RabbitMQ, Redis)
4. **Observable** — distributed tracing, metrics, and error tracking from API to workers

## Scope

### In Scope

- Order lifecycle (create → reserve inventory → payment → shipment → delivered / cancelled)
- Payment saga with HMAC-signed webhook integration (mock provider included)
- Inventory reservation with compensation on payment failure
- Multi-channel notifications (email real; SMS stubbed)
- User authentication (JWT + argon2)
- Admin product catalog management
- Customer order tracking
- Idempotency at three layers (HTTP, webhook, consumer)
- Observability (OpenTelemetry, Prometheus, Sentry, Jaeger)
- Deployment pipelines (Fly.io, VPS + Docker Compose, Kubernetes + Helm sketched)
- 102 e2e + integration tests covering happy path and all compensation scenarios

### Out of Scope

- Real payment gateway (mock + HMAC signature pattern provided for Stripe/Sepay integration)
- SMS gateway (stub channel demonstrating the pattern)
- Kubernetes Helm charts (architecture documented, not deployed)
- GraphQL (REST + OpenAPI only)
- Frontend (headless API)

## Key Architectural Decisions

### 1. Choreography Saga + Transactional Outbox (vs. Orchestration)

**Decision:** Choreography saga with outbox relay.

**Why:**

- Outbox pattern eliminates dual-write consistency gap (state + event in one ACID tx)
- No central coordinator = simpler failure handling; each consumer knows its compensation path
- Scales to many events without central bottleneck
- At-least-once delivery + idempotent consumers = simple mental model

**Trade-off:** Order flow is distributed across consumers, harder to visualize globally (mitigated by tracing + event table).

### 2. Idempotency at Three Layers

**Decision:** HTTP `Idempotency-Key` + webhook dedup + per-consumer `processed_messages` table.

**Why:**

- Clients retry failed network requests → `Idempotency-Key` (Redis fast-path + idempotency table)
- Payment providers replay webhooks → provider `event_id` (Redis fast-path) + `processed_messages` durable backstop
- RabbitMQ redelivery on nack → consumer inserts `(consumer, event_id)` PK before processing

**Trade-off:** Three layers is redundant for a single failure mode, but each handles different failure origins (client, provider, broker).

### 3. Service Layer Has No Database Access

**Decision:** All DB operations in the Repository layer; Service is pure business logic.

**Why:**

- Testable without mocking infrastructure
- Clear separation of concerns
- Transaction boundary management lives in one place
- Service can be called by both HTTP handlers and background consumers

### 4. Compare-and-Set State Transitions

**Decision:** Every state change uses `UPDATE … WHERE status = <from>` (CAS, not blind overwrites).

**Why:**

- Prevents illegal transitions (e.g., reviving a cancelled order on late `payment.succeeded`)
- Detects races between concurrent writers (cancel vs shipping worker)
- No need for distributed locks; the DB row lock does it

### 5. Event as Domain Entity (not transient)

**Decision:** Events are persisted in `outbox_messages`, not ephemeral.

**Why:**

- Events are the audit trail for regulatory/debugging
- Relay can recover from broker downtime
- No need to rebuild state from event log; events are immutable proof of what happened

### 6. Types-as-Constants + Union Types (no pgEnum)

**Decision:** Status values stored as plain strings in DB; TypeScript `as const` objects define the SSoT.

**Why:**

- Avoids DB-level enum type bloat
- Status additions don't require migrations
- TypeScript union types catch invalid transitions at compile time
- SQL is more portable

### 7. RBAC with Permission Const Objects

**Decision:** Roles and permissions defined as const objects in TypeScript; checked at runtime via `hasPermission()` guard.

**Why:**

- Easy to audit who can do what
- No database-backed permission table complexity
- Permission set changes are code changes (reviewed via PR)

## Success Criteria

✅ **Correctness:** Saga happy path and all compensation scenarios verified by e2e tests  
✅ **Zero event loss:** Outbox relay guarantees; broker downtime does not drop events  
✅ **Idempotency:** Client retries, webhook replays, and consumer redelivery are all safe (no double-charges, no duplicate shipments)  
✅ **Observable:** Distributed trace from API request through all consumers; Prometheus metrics for saga step counters  
✅ **Deployable:** Migration gate, 3 deployment tiers (Fly.io, VPS, K8s), secrets not in code  
✅ **Testable:** Real infrastructure via Testcontainers; 102 tests green

## Non-Functional Requirements

| Requirement       | Implementation                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Availability**  | No single points of failure; API + Worker on separate processes, managed/external DB/broker    |
| **Latency**       | API response ≤ 100ms (state write + outbox only); async work runs in worker                    |
| **Consistency**   | ACID transactions ensure state + event written atomically; CAS prevents illegal transitions    |
| **Durability**    | Postgres WAL + replication for data; RabbitMQ durability + outbox relay for events             |
| **Observability** | W3C trace context, Prometheus counters, structured Pino logs with correlationId                |
| **Compliance**    | Secrets externalized (never in code); audit trail via order_status_history + outbox_messages   |
| **Security**      | HTTPS-only reverse proxy, JWT stateless auth, HMAC webhook signatures, rate limiting via Redis |

## Technology Choices

| Layer           | Choice                              | Rationale                                                             |
| --------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Framework       | Fastify v5                          | Plugin encapsulation, TypeBox integration, excellent observability    |
| Database        | PostgreSQL 17 + Drizzle ORM         | ACID guarantees, strong types via Drizzle, no runtime surprises       |
| Message Broker  | RabbitMQ + amqplib                  | Topic exchange, per-consumer queues, DLX, proven reliability          |
| Cache / Session | Redis 8 + ioredis                   | Fast, single-purpose (idempotency keys, webhook dedup, catalog cache) |
| Validation      | TypeBox + AJV                       | Write schema once, get TS type + JSON Schema auto; AJV is fast        |
| Auth            | @fastify/jwt + argon2               | Stateless, no session overhead; argon2 is memory-hard                 |
| Testing         | Vitest + Testcontainers             | Real infrastructure, no mocks; fast parallel test runs                |
| Observability   | OpenTelemetry + Prometheus + Sentry | Industry standard, polyglot-friendly, vendor-agnostic                 |

## Constraints

- **Node 24 LTS** — fixed for long-term support and recent async/await ergonomics
- **TypeScript ESM** — no CommonJS; `"type": "module"` + `.js` import specifiers
- **Single image, two commands** — API and worker share codebase and container; different entrypoints
- **No ORM wizardry** — Drizzle schemas define tables; migrations explicit; no magic conventions
- **Minimal dependencies** — YAGNI: no BullMQ (RabbitMQ suffices), no Zod (TypeBox does the job), no real payment SDK (HMAC pattern is portable)

## Future Considerations

- **Per-channel notification dedup** — currently SMS is stubbed; real SMS gateway would need provider dedup
- **Payment gateway integration** — HMAC webhook pattern shown; Stripe/Sepay integration is copy-paste + secrets
- **Horizontal scaling** — API and worker scale independently; relay uses `FOR UPDATE SKIP LOCKED` for multi-process safety
- **Circuit breaker** — optional pattern for external service resilience
- **Analytics** — separate read model (not built; event stream provides the data)
