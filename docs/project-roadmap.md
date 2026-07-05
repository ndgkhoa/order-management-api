# Project Roadmap

## Current Status: v0.1.4

The project is **production-ready** for learning and deployment scenarios. All core features are implemented and tested.

## Completed Features

### Phase 0: Foundation (✅ Complete)

- TypeScript ESM with Fastify v5
- Drizzle ORM + PostgreSQL schema + migrations
- Docker Compose local dev stack (Postgres, RabbitMQ, Redis, Mailpit, observability)
- ESLint + Prettier + Husky + commitlint
- Vitest + Testcontainers for real infrastructure testing

### Phase 1: Auth & Users (✅ Complete)

- User registration with argon2 password hashing
- JWT login / token refresh
- Multi-role RBAC (admin, user, guest)
- Permission-based access control guards
- User profile + role assignments

### Phase 2: Products & Catalog (✅ Complete)

- Admin product CRUD (create, read, update, delete)
- Redis-cached public catalog (cache-aside + invalidate-on-write)
- Product availability checks
- Price and description management

### Phase 3: Order Lifecycle (✅ Complete)

- Order creation with transactional outbox
- Order status machine (pending → paid → fulfilling → delivered / cancelled)
- Order history tracking (all transitions logged)
- Order cancellation (pre-ship refund + restock)
- Order refund (paid → refunded)
- Idempotency on order mutation endpoints

### Phase 4: Inventory Management (✅ Complete)

- Stock reservation with CAS guards (all-or-nothing per order)
- Stock commit when payment succeeds
- Stock release on payment failure (compensation)
- Stock restock on customer refund
- Per-line-item and aggregate validation
- Inventory history / audit trail

### Phase 5: Payment Integration (✅ Complete)

- Payment state machine (pending → paid / failed / refunded)
- HMAC-signed webhook handler (mock provider included)
- Payment creation on inventory.reserved
- Payment saga (payment.created → webhook → payment.succeeded → order.paid)
- Payment compensation (payment.failed → order.cancelled + release stock)
- Webhook dedup (provider event_id + processed_messages)
- Idempotent webhook replay handling

### Phase 6: Shipping (✅ Complete)

- Shipment state machine (pending → ready_for_pickup → in_transit → delivered)
- Fake carrier worker (timed state advances per `SHIPPING_STEP_MS`)
- Shipment creation on order.paid
- Shipment status history
- Admin shipment status override (manual advance)
- Graceful handling of order cancellation during fulfillment

### Phase 7: Notifications (✅ Complete)

- Event-driven, channel-agnostic notification dispatcher
- Multi-channel support (email real, SMS stubbed)
- Email templates for key events (order confirmation, paid, shipped, delivered, cancelled, refunded)
- SMS notification channel (stubbed; pattern shown)
- Notification template engine (custom placeholders)
- Dedup before sending (not retryable; sent once per event)

### Phase 8: Idempotency & Reliability (✅ Complete)

- HTTP Idempotency-Key header caching (Redis + idempotency table)
- Consumer dedup via processed_messages composite PK
- Payment webhook dedup (provider event_id + Redis + processed_messages)
- Transactional Outbox pattern (zero event loss)
- Outbox relay with SKIP LOCKED (both API and worker)
- Compare-and-set state transitions (CAS via WHERE status = <from>)
- Graceful shutdown (SIGTERM drain, in-flight request completion)

### Phase 9: Observability (✅ Complete)

- OpenTelemetry distributed tracing (W3C context propagation)
- Prometheus metrics (request count, latency, error rate)
- Grafana dashboard (request metrics, saga counters)
- Jaeger trace visualization
- Sentry error tracking
- Pino structured logging with correlationId
- Health + readiness probes (/health, /ready)

### Phase 10: Testing (✅ Complete)

- Unit tests (102 tests, all green)
- Testcontainers integration tests (real Postgres, RabbitMQ, Redis)
- E2E tests for saga happy path and compensation scenarios
- 80%+ code coverage
- Tests verify idempotency and concurrent failures

### Phase 11: Deployment (✅ Complete)

- Multi-stage Docker build (minimal runtime image)
- Migration gate (drizzle-orm migrator, idempotent)
- Fly.io deployment (with fly.toml template)
- VPS + Docker Compose + Caddy TLS
- Kubernetes + Helm sketch (documented, not deployed)
- GitHub Container Registry + Docker Hub pushes
- Release-please automated versioning
- Secrets externalized (never in code)

---

## Next Steps (Roadmap)

### Short Term (Recommended Before Production)

#### 1. Real Payment Gateway Integration

**Priority:** HIGH  
**Why:** Mock provider is for learning; production needs real payment flow

- Integrate Stripe / Sepay (HMAC pattern already proven)
- Replace mock payment webhook with real provider endpoint
- Add payment method CRUD (credit card, e-wallet, bank transfer)
- Test webhook replay with real provider sandbox
- Estimate effort: 2–3 days

#### 2. Per-Channel Notification Dedup

**Priority:** MEDIUM  
**Why:** Currently SMS is stubbed; real SMS gateway would need provider-specific dedup

- Implement SMS channel with real provider (Twilio, etc.)
- Add provider-specific dedup (similar to payment webhook)
- Test SMS notification flow with Testcontainers (or real provider sandbox)
- Estimate effort: 1–2 days

#### 3. Auth Hardening

**Priority:** MEDIUM  
**Why:** Current auth is functional; production should add:

- Refresh token rotation + revocation
- Rate limiting on login (brute force protection)
- Email verification on registration
- Password reset flow
- Session management (optional, depends on client type)
- Estimate effort: 2 days

#### 4. Order Admin Dashboard

**Priority:** LOW (depends on front-end availability)  
**Why:** Admins need visibility

- List orders with filters (status, date range, customer)
- Drill-down order details + event timeline
- Manual order state override (edge case recovery)
- Order search
- Estimate effort: 3–5 days (depends on front-end stack)

### Medium Term

#### 5. Analytics & Reporting

**Priority:** MEDIUM  
**Why:** Business insights

- Separate read model (CQRS) for analytics
- Dashboard: daily orders, revenue, cancellation rates, payment success rate
- Exportable reports (CSV)
- Could use event stream as data source (no code change needed)
- Estimate effort: 4–5 days

#### 6. Circuit Breaker Pattern

**Priority:** LOW  
**Why:** Resilience against failing external services

- Add circuit breaker for payment gateway (if provider is flaky)
- Add circuit breaker for email provider
- Graceful degradation when circuits open
- Estimate effort: 1 day

#### 7. Rate Limiting Per User

**Priority:** LOW  
**Why:** Current rate limiting is global (per-IP via Redis)

- Add per-user rate limits (users can place N orders per minute)
- Add per-product rate limits (prevent order spam)
- Estimate effort: 1 day

#### 8. Webhook Management UI

**Priority:** LOW  
**Why:** Admin needs to manage webhook subscriptions

- List configured webhooks
- Add/remove webhook subscriptions
- Retry failed webhook deliveries
- View webhook delivery logs
- Estimate effort: 2 days

### Long Term

#### 9. Horizontal Scaling & Multi-Region

**Priority:** STRETCH  
**Why:** High-availability production setup

- API and worker scale independently
- Database replication / read replicas
- Multi-region failover (Fly.io regions or global load balancing)
- Distributed cache (Redis Cluster)
- Estimate effort: 1–2 weeks (infrastructure work)

#### 10. Advanced Saga Patterns

**Priority:** STRETCH  
**Why:** More complex order scenarios

- Split orders (partial fulfillment on different shipments)
- Order bundling (combine multiple orders for bulk discount)
- Saga retry strategy (exponential backoff vs. immediate retry)
- Saga timeouts (orders stuck in pending state too long)
- Estimate effort: 1–2 weeks

#### 11. Event Sourcing (Optional)

**Priority:** STRETCH  
**Why:** Full audit trail + temporal queries

- Store events as the source of truth
- Rebuild state from event log
- Snapshots for performance
- Temporal queries (what was the order status at 3pm?)
- Estimate effort: 2–3 weeks (major refactor)

---

## Success Metrics

| Metric                         | Current          | Target               |
| ------------------------------ | ---------------- | -------------------- |
| **Test coverage**              | 80%+             | >85%                 |
| **E2E test duration**          | ~5s              | <10s                 |
| **API response latency (p95)** | <100ms           | <150ms (acceptable)  |
| **Saga completion time**       | ~2s (happy path) | <5s (acceptable)     |
| **Outbox relay lag**           | <1s              | <5s                  |
| **Uptime**                     | N/A (test env)   | 99.9% (production)   |
| **Payment success rate**       | 100% (mock)      | >95% (real provider) |
| **Zero event loss**            | ✅ Proven        | ✅ Maintained        |

---

## Known Limitations & Trade-Offs

| Limitation               | Rationale                          | Workaround                                    |
| ------------------------ | ---------------------------------- | --------------------------------------------- |
| Mock payment provider    | Learning project, avoids paid SDK  | Integrate real provider (pattern shown)       |
| SMS is stubbed           | Real SMS costs money               | Integrate real SMS provider (pattern shown)   |
| No per-user rate limits  | Global Redis rate limit is simpler | Add user_id dimension to rate limit keys      |
| No order splitting       | Complexity not needed for MVP      | Implement split-order saga pattern if needed  |
| No event sourcing        | Transactional Outbox is sufficient | Migrate to ES if audit trail becomes critical |
| Single-region deployment | Simplifies setup                   | Deploy to multiple regions with global LB     |

---

## Feature Flags (Future)

Consider adding feature flags for:

- Experimental payment providers (before GA)
- A/B testing (discount strategies, checkout flow)
- Gradual rollout of new notification channels
- Circuit breaker toggle (enable/disable resilience)

Could use Fastify environment or a simple Redis-backed flag store.

---

## Contributing & Roadmap Changes

- Roadmap is updated after each release
- Community feedback welcome via GitHub issues
- Breaking changes documented in CHANGELOG
- Deprecated features announced 1 release in advance

Current maintainer: ndgkhoa (Learning project; best-effort support)

---

## Release Schedule

- **v0.1.x** — Bug fixes, documentation, code quality
- **v0.2.0** — Real payment gateway integration + per-channel notification dedup (estimated Q3 2026)
- **v1.0.0** — Production-hardened (Q4 2026 or later, depends on real-world deployment feedback)

See [GitHub Releases](https://github.com/ndgkhoa/order-management-api/releases) for version history.
