# Tech Stack & Architecture — fastify-drizzle

Production-grade learning API. Learning goals: **Fastify v5, RabbitMQ, DevOps, senior backend design patterns**.

## Business Flow (async — the core)

```
[Client] → POST /orders → [Fastify API] → persist Order (Postgres, single transaction)
                              │  same transaction also writes to the outbox table
                              └→ Outbox relay → publish "order.created" → [RabbitMQ exchange]
                                                                              │
                                       [Email Worker] ── consume (idempotent) ┘ → Nodemailer → email
```

The API responds immediately (it does NOT block waiting for the email to be sent). This is the core point of using a message queue.

## Stack (versions verified via context7, 2026-06)

### Core

| Layer         | Choice                                               | Version            | Note                                                           |
| ------------- | ---------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| Runtime       | Node.js + TypeScript                                 | Node **24** LTS    |                                                                |
| Framework     | **Fastify**                                          | v5                 | plugin encapsulation, schema-based validation                  |
| ORM           | **Drizzle ORM** + drizzle-kit                        | drizzle-kit 0.31.x | node-postgres (`pg`) driver                                    |
| Database      | **PostgreSQL**                                       | 17                 |                                                                |
| Message Queue | **RabbitMQ** + `amqplib`                             | RabbitMQ 4.x       | producer/consumer, DLQ                                         |
| Validation    | **TypeBox** + `@fastify/type-provider-typebox`       | —                  | write JSON Schema + TS type once; **AJV** validates underneath |
| Auth          | `@fastify/jwt` + **argon2**                          | —                  | stateless JWT, argon2 password hashing                         |
| Email         | **Nodemailer** + **Mailpit** (dev)                   | —                  | Mailpit = fake SMTP server + UI                                |
| Logging       | **Pino** (built-in) + pino-pretty (dev)              | —                  | structured JSON + correlation id                               |
| Test          | **Vitest** + Fastify `inject()` + **Testcontainers** | —                  | unit / api / integration                                       |

### Security plugins

`@fastify/cors` · `@fastify/helmet` · `@fastify/rate-limit` (in-memory) · `@fastify/sensible`

### Monitoring / Observability

- **Prometheus** + `fastify-metrics` → **Grafana** dashboard (RPS, latency p95/p99, error rate)
- **OpenTelemetry** → **Jaeger** — distributed tracing across API → RabbitMQ → Worker
- **Sentry** (`@sentry/node`) — error tracking + stack traces
- **Health/readiness probes** — `/health` (liveness) + `/ready` (checks DB & RabbitMQ)

### Dev Tools / DX

**ESLint + Prettier** · `@fastify/swagger` + swagger-ui (OpenAPI generated from TypeBox) · **Husky + lint-staged + commitlint** · **Testcontainers** · **tsx** (hot reload) · `@fastify/env` (validate env at boot) · Drizzle Studio (DB GUI)

### Build tooling

**Path aliases** (`@/`, `@config/`, `@infra/`, `@modules/`, `@plugins/`) resolved by `tsc-alias` (build) and `vite-tsconfig-paths` (tests). **rimraf** to clean `dist/` cross-platform before each build.

### Excluded (YAGNI)

- ❌ Redis — RabbitMQ handles async; rate-limit is in-memory; JWT is stateless. Add later if scaling beyond one instance (distributed rate-limit / refresh-token denylist / idempotency keys).
- ❌ Zod — using TypeBox (AJV-native).
- ❌ BullMQ — would duplicate RabbitMQ.

## Design Patterns Applied (⭐ = implemented in code)

- **Architectural**: Layered (Route → Controller → Service → Repository), Modular Monolith (`modules/users`, `modules/orders`), Event-Driven
- **Data**: Repository, DTO, Unit of Work (transaction)
- **Messaging / Reliability** (the focus): Producer/Consumer, **Transactional Outbox**, Idempotent Consumer, **Dead Letter Queue**, Retry + Exponential Backoff
- **GoF**: Dependency Injection (Fastify decorators/plugins), Decorator, Singleton (db pool / logger / config), Adapter (wraps Nodemailer / Sentry)
- **Resilience**: Graceful Shutdown (SIGTERM drain), Health/Readiness, Rate Limiting
- **Cross-cutting**: Plugin/encapsulation, 12-Factor config, Structured Logging + Correlation ID

## Module Structure (target)

```
src/
├── modules/
│   ├── auth/      (register, login, jwt)
│   ├── users/     (route → controller → service → repository)
│   └── orders/    (+ outbox publish)
├── infra/
│   ├── db/        (drizzle client, schema, migrations)
│   ├── mq/        (rabbitmq connection, publisher, consumer)
│   ├── mail/      (nodemailer adapter)
│   └── telemetry/ (otel, metrics, sentry)
├── plugins/       (jwt, cors, helmet, rate-limit, sensible, swagger, env)
├── workers/       (email consumer process)
├── config/        (env schema)
├── app.ts         (build Fastify instance)
└── server.ts      (listen + graceful shutdown)
```

## DevOps / Deploy

- **Local**: `docker compose up` → api + worker + postgres + rabbitmq + mailpit + prometheus + grafana + jaeger
- **Dockerfile**: multi-stage (deps → build → runner node:24-alpine, non-root + HEALTHCHECK), one image runs both api & worker (different CMD)
- **Migration**: `drizzle-kit generate` (commit) → `drizzle-kit migrate` on deploy
- **CI**: GitHub Actions — install → ESLint → typecheck → test (unit + Testcontainers) → build image → push GHCR
- **CD path**: Fly.io/Railway (easy) → VPS + docker compose + Caddy/Traefik (TLS) → Kubernetes + Helm (stretch goal)

## Stretch Goals (noted, not built)

`@fastify/under-pressure` (load shedding) · Redis (distributed rate-limit / refresh token) · Circuit Breaker · ArgoCD GitOps · HPA autoscaling
