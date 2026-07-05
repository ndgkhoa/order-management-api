# Codebase Summary

## Directory Layout

```
order-management-api/
├── src/
│   ├── modules/
│   │   ├── auth/              # register, login, JWT token exchange
│   │   ├── users/             # user CRUD, role/permission checks
│   │   ├── products/          # admin CRUD + Redis-cached public catalog
│   │   ├── orders/            # order create/cancel/refund, status history, outbox tx
│   │   ├── payments/          # payment lifecycle, HMAC webhook, saga consumers
│   │   ├── shipping/          # shipment state machine, fake carrier worker, timed advances
│   │   ├── notifications/     # channel-agnostic dispatcher, email/SMS templates
│   │   ├── inventory/         # stock reserve/commit/release, domain logic
│   │   └── health/            # liveness + readiness probes
│   ├── infra/
│   │   ├── db/                # Drizzle schema, migrations (drizzle/), migrator
│   │   ├── mq/                # RabbitMQ connection, topology (exchange/queue), relay, consumers
│   │   ├── mail/              # Nodemailer adapter
│   │   ├── notify/            # notification channel implementations
│   │   ├── redis/             # ioredis client, cache helpers
│   │   ├── telemetry/         # OpenTelemetry setup, metrics, saga counters, Sentry
│   │   └── http/              # optional HTTP client wrapper
│   ├── plugins/               # env validation, security (cors, helmet, rate-limit), JWT, idempotency, swagger, error-handler
│   ├── workers/               # background worker entry; saga consumers + relay + reaper
│   ├── sagas/                 # choreography saga step consumers
│   ├── config/                # env schema (Fastify env plugin)
│   ├── types/                 # domain types: statuses, roles, permissions, currencies
│   ├── constants/             # magic constants: cache keys, consumer names, TTLs
│   ├── utils/                 # helpers: state-machine FSM, error types
│   ├── app.ts                 # build Fastify instance (no listen)
│   └── server.ts              # listen + graceful shutdown
├── drizzle/                   # auto-generated SQL migrations
├── test/
│   ├── unit/                  # mirrors src/modules structure; unit tests (no db)
│   ├── integration/           # module integration; real Postgres + RabbitMQ
│   └── e2e/                   # end-to-end saga flows (happy path + compensation)
├── docker-compose.yml         # local dev stack (Postgres, RabbitMQ, Redis, Mailpit, Prometheus, Grafana, Jaeger, Alloy)
├── docker-compose.prod.yml    # prod overlay (hardened, memory limits, restart policies)
├── Dockerfile                 # multi-stage: deps → build → runner (node:24-alpine)
├── package.json               # Node 24 ESM, main = dist/server.js
├── tsconfig.json              # path aliases (@/, @modules/, @infra/, @plugins/, @test/)
├── vitest.config.ts           # Testcontainers, vite-tsconfig-paths
├── .eslintrc.cjs              # typed ESLint config
├── .prettierrc                 # Prettier 3.x
├── .env.example               # all required + optional env vars with defaults
├── Makefile                   # convenience targets (build, test, etc.)
└── README.md                  # quickstart + links to docs/
```

## Module Responsibilities (5-Layer Pattern)

Each module follows **Route → Controller → Service → Repository → Schema**:

| Layer          | Owns                                                | Example                                                 |
| -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| **Route**      | HTTP binding, request/response mapping, path params | `POST /orders` → controller.create()                    |
| **Controller** | Validation, auth guard, response formatting         | deserialize body, call service, format 201 response     |
| **Service**    | Business logic, orchestration, error handling       | "order.pending + outbox event in 1 tx"                  |
| **Repository** | All DB operations, transaction management           | `INSERT order … + INSERT outbox_messages … RETURNING …` |
| **Schema**     | Type definitions, status enums, row types           | `OrderStatus`, `OrderRow`, `CreateOrderDTO`             |

### Module Overview

| Module            | Responsibility                                                     | Key Consumers                                        |
| ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **auth**          | Register, login, token refresh                                     | user registration flow                               |
| **users**         | User CRUD, profile, role assignments                               | admin panel                                          |
| **products**      | Admin product management, Redis-cached public catalog              | GET /products (cached), /admin/products CRUD         |
| **orders**        | Order creation (with outbox), cancellation, refund, status history | Core order saga; entry point                         |
| **payments**      | Payment state machine, HMAC webhook handler, saga consumers        | order → payment flow                                 |
| **shipping**      | Shipment state machine, fake carrier worker, timed state advances  | order.paid → shipment → order.delivered              |
| **inventory**     | Stock reservation with guards, commit, release, restock            | saga compensation                                    |
| **notifications** | Event-driven dispatcher, multi-channel templates                   | order.created, order.paid, shipment.delivered events |
| **health**        | `/health` (liveness), `/ready` (DB + RabbitMQ checks)              | K8s probes                                           |

## Tech Stack Details

### Core Runtime & Framework

| Component      | Version | Why                                                                                      |
| -------------- | ------- | ---------------------------------------------------------------------------------------- |
| **Node.js**    | 24 LTS  | Latest LTS; excellent async/await, strong TypeScript support                             |
| **TypeScript** | 5.x     | Full type safety; ESM `--module esnext`, path aliases                                    |
| **Fastify**    | v5      | Plugin encapsulation, schema-based validation via TypeBox, excellent observability hooks |

### Database & ORM

| Component              | Version | Why                                                                              |
| ---------------------- | ------- | -------------------------------------------------------------------------------- |
| **PostgreSQL**         | 17      | ACID guarantees, strong consistency for saga state, jsonb support                |
| **Drizzle ORM**        | 0.31.x  | Type-safe query builder, migrations are explicit SQL files, no magic conventions |
| **node-postgres (pg)** | driver  | Connection pooling, full PG feature access                                       |

### Message Broker

| Component    | Version | Why                                                                                                  |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| **RabbitMQ** | 4.x     | Topic exchange (fan-out + routing), per-consumer queues, DLX for failed messages, proven reliability |
| **amqplib**  | driver  | AMQP protocol, good library, widely used                                                             |

### Caching & Session

| Component   | Version | Why                                                                                  |
| ----------- | ------- | ------------------------------------------------------------------------------------ |
| **Redis**   | 8       | Single-purpose KV; fast idempotency key checks, webhook dedup, product catalog cache |
| **ioredis** | driver  | Connection pooling, cluster support, key serialization helpers                       |

### Validation & Type Coercion

| Component                          | Version     | Why                                                                               |
| ---------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| **TypeBox**                        | current     | Write JSON Schema + TS type once; AJV validates underneath; zero-cost abstraction |
| **@fastify/type-provider-typebox** | —           | Auto-generates OpenAPI from TypeBox schemas                                       |
| **AJV**                            | via TypeBox | Fast, spec-compliant JSON Schema validator                                        |

### Authentication & Authorization

| Component        | Version | Why                                                            |
| ---------------- | ------- | -------------------------------------------------------------- |
| **@fastify/jwt** | —       | Stateless JWT; signs/verifies with secret                      |
| **argon2**       | —       | Memory-hard password hashing; resistant to GPU attacks         |
| **Custom RBAC**  | —       | Permission const objects, `hasPermission()` guard, lightweight |

### Email & Notifications

| Component         | Version | Why                                                  |
| ----------------- | ------- | ---------------------------------------------------- |
| **Nodemailer**    | —       | Universal SMTP client, flexible providers            |
| **Mailpit** (dev) | —       | Fake SMTP server with web UI, no external dependency |

### Testing & Quality

| Component          | Version | Why                                                                          |
| ------------------ | ------- | ---------------------------------------------------------------------------- |
| **Vitest**         | —       | Fast, ESM-native, excellent TypeScript support                               |
| **Testcontainers** | —       | Real infrastructure (Postgres, RabbitMQ, Redis) in tests; no mocks for infra |
| **ESLint**         | —       | Typed config, @typescript-eslint rules                                       |
| **Prettier**       | 3.x     | Opinionated code formatting, zero config                                     |
| **Husky**          | —       | Git pre-commit hooks                                                         |
| **commitlint**     | —       | Enforce conventional commits                                                 |

### Observability & Monitoring

| Component         | Version      | Why                                                     |
| ----------------- | ------------ | ------------------------------------------------------- |
| **OpenTelemetry** | core         | Distributed tracing, W3C trace context, vendor-agnostic |
| **Prometheus**    | —            | Metrics scrape; Fastify exports request/latency metrics |
| **Grafana**       | —            | Dashboard for metrics                                   |
| **Jaeger**        | —            | Trace visualization and analysis                        |
| **Sentry**        | @sentry/node | Error tracking with stack traces, session replay        |
| **Pino**          | —            | Structured JSON logging, built-in to Fastify            |

### Logging & Structured Data

| Component             | Version | Why                                        |
| --------------------- | ------- | ------------------------------------------ |
| **Pino**              | —       | Fastify's native logger, JSON output, fast |
| **pino-pretty** (dev) | —       | Pretty-print during local development      |

### DevOps & Deployment

| Component                                 | Version | Why                                           |
| ----------------------------------------- | ------- | --------------------------------------------- |
| **Docker**                                | —       | Multi-stage build, one image for api + worker |
| **docker-compose**                        | —       | Local dev environment orchestration           |
| **Caddy** / **Traefik**                   | —       | Reverse proxy + auto HTTPS (optional)         |
| **Fly.io** / **Railway** / **Kubernetes** | —       | Three deployment tiers supported              |

### Excluded (YAGNI)

- ❌ **Zod** — TypeBox + AJV is sufficient
- ❌ **BullMQ** — RabbitMQ already handles job queuing
- ❌ **Real payment gateway SDK** — HMAC webhook pattern is SDK-agnostic
- ❌ **SMS provider** — Stubbed channel demonstrates the pattern
- ❌ **GraphQL** — REST + OpenAPI is simpler for a learning project
- ❌ **Prisma** — Drizzle provides better type safety and control

## Conventions & Patterns

### Naming

- **Files:** kebab-case (e.g., `order-status.ts`, `payment-webhook.ts`)
- **Status/type constants:** SCREAMING_SNAKE_CASE (e.g., `ORDER_STATUS.PENDING`)
- **Consumers:** kebab-case (e.g., `inventory-reserve`, `payment-create`)
- **Database tables:** snake_case, plural (e.g., `orders`, `outbox_messages`)

### Path Aliases

- `@/` → `src/`
- `@modules/` → `src/modules/`
- `@infra/` → `src/infra/`
- `@plugins/` → `src/plugins/`
- `@test/` → `test/`

### Database Patterns

- **No ORM magic:** Migrations are explicit SQL files
- **Types:** `InferSelectModel<typeof table>` for row types, `typeof table.$inferInsert` for inserts
- **Transactions:** All saga operations use `db.transaction()` with proper isolation
- **No soft deletes:** Deleted records are removed (or archived separately)

### State Machines

- **Status definitions:** `types/{entity}-status.ts` (e.g., `types/order-status.ts`)
- **All transitions via CAS:** `UPDATE … WHERE status = <from>` prevents illegal transitions
- **History tracking:** `order_status_history` records every transition + reason

## Build & Deploy

### Local Development

```bash
npm install
docker compose up -d              # Postgres, RabbitMQ, Redis, Mailpit, etc.
npm run db:migrate                # Apply Drizzle migrations
npm run dev                        # API with tsx hot reload
npm run dev:worker                # Worker in another shell
npm test                          # Run tests
```

### Production Build

```bash
npm run build                     # Clean + tsc → dist/ + tsc-alias path resolution
npm run lint && npm run typecheck # Validate before deploy
npm test                          # Run full suite
docker build -t myapp:v1 .       # Multi-stage: deps → build → alpine runner
```

### Docker Image

- **One image, two commands:**
  - `node dist/server.js` → API (listens on port 3000)
  - `node dist/workers/worker.js` → Background worker
- **Migration gate:** `node dist/infra/db/migrate.js` runs before any process starts
- **Health checks:** Dockerfile includes HEALTHCHECK

## Test Coverage

- **Unit tests** (test/unit) — business logic, no DB
- **Integration tests** (test/integration) — module + real Postgres/RabbitMQ
- **E2E tests** (test/e2e) — full saga flows (happy path + compensation scenarios)
- **Coverage:** 102 tests, all green; covers order lifecycle, compensation, idempotency layers

## Performance Considerations

- **API response:** ≤100ms (writes state + outbox, returns immediately)
- **Async work:** Offloaded to background workers
- **Caching:** Product catalog cached in Redis (cache-aside + invalidate-on-write)
- **Connection pooling:** Postgres (20 connections), RabbitMQ (1 connection, multi-channel)
- **Rate limiting:** Redis-backed, shared across instances
