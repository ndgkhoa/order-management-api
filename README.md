# fastify-drizzle

A production-shaped **learning** REST API. The goal is to learn, by building something real:
**Fastify v5**, **RabbitMQ** (async messaging done right), **DevOps**, and the **design patterns senior backend engineers actually use**.

> Status: 🚧 In progress — built incrementally, one phase at a time. See [`plans/`](./plans/) for the phase-by-phase plan.

## What it does

1. **Register** an account (email + password, hashed with argon2, JWT auth).
2. Authenticated user **creates an order**.
3. The system sends an **email notification asynchronously** — the API does _not_ block waiting for the email.

### The async flow (the whole point)

```
[Client] POST /orders ──▶ [Fastify API]
                            │ ONE db transaction:
                            │   INSERT order  +  INSERT outbox_messages(order.created)
                            ▼
                          201 Created (immediate — does NOT wait for email)
                            │
                  [Outbox Relay] polls unsent outbox rows
                            │ publishes "order.created"
                            ▼
                 [RabbitMQ] exchange ──▶ queue ──(fail × N)──▶ DLX ▶ Dead Letter Queue
                            │
                  [Email Worker] consumes idempotently
                            │ Nodemailer
                            ▼
                        [Mailpit] (dev SMTP + web UI)
```

The **Transactional Outbox** pattern guarantees the event is never lost even if the broker is briefly down — the order and the event are written in the same DB transaction.

## Tech stack

Node 24 · TypeScript (ESM) · Fastify v5 · Drizzle ORM + PostgreSQL 17 · RabbitMQ (amqplib) · TypeBox + AJV validation · `@fastify/jwt` + argon2 · Nodemailer + Mailpit · Pino.
**Security:** cors, helmet, rate-limit, sensible. **Observability:** Prometheus + Grafana, OpenTelemetry + Jaeger, Sentry, health/readiness probes. **Quality:** ESLint + Prettier, Husky + commitlint, Vitest + Testcontainers.

Full rationale and versions: [`docs/tech-stack.md`](./docs/tech-stack.md).

## Design patterns applied

Layered (Route → Controller → Service → Repository) · Modular Monolith · Repository · DTO · Producer/Consumer · **Transactional Outbox** · Idempotent Consumer · Dead Letter Queue · Retry + exponential backoff · Dependency Injection (Fastify decorators) · Graceful Shutdown · Health/Readiness · Structured Logging + Correlation ID · 12-Factor config.

## Project structure

```
src/
├── modules/{auth,users,orders}/   # route → controller → service → repository
├── infra/{db,mq,mail,telemetry,http}/
├── plugins/                       # env, security, jwt, swagger, error-handler...
├── workers/                       # email consumer process
├── config/                        # env schema (validated at boot)
├── app.ts                         # build Fastify instance (no listen)
└── server.ts                      # listen + graceful shutdown
```

## Getting started

> Full local stack (Postgres, RabbitMQ, Mailpit, Prometheus, Grafana, Jaeger) via `docker compose` lands in phase 02.

```bash
nvm use                # Node 24
npm install
cp .env.example .env    # then fill JWT_SECRET (32+ chars) etc.

npm run dev             # start API (hot reload via tsx)
npm run dev:worker      # start email worker
```

### Scripts

| Script                                             | Purpose                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| `npm run dev` / `dev:worker`                       | Hot-reload API / email worker                    |
| `npm run build`                                    | Clean + compile (`rimraf` → `tsc` → `tsc-alias`) |
| `npm run lint` / `format`                          | ESLint (typed) / Prettier                        |
| `npm run typecheck`                                | `tsc --noEmit`                                   |
| `npm test` / `test:cov`                            | Vitest / with coverage                           |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit migrations / Studio                  |

## Roadmap

10 incremental phases: scaffolding → docker infra → DB (Drizzle) → Fastify core + RFC 7807 errors → auth/users → orders + Outbox → RabbitMQ + email worker → observability → testing → CI/CD + deploy. Track progress in [`plans/`](./plans/).

## License

[MIT](./LICENSE) © 2026 ndgkhoa
