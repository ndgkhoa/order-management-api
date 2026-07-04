# order-management-api

[![CI](https://github.com/ndgkhoa/order-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ndgkhoa/order-management-api/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ndgkhoa/order-management-api/actions/workflows/codeql.yml/badge.svg)](https://github.com/ndgkhoa/order-management-api/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/ndgkhoa/order-management-api?sort=semver)](https://github.com/ndgkhoa/order-management-api/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A production-shaped, event-driven order backend on Fastify v5, Drizzle ORM + PostgreSQL, RabbitMQ and Redis. It runs the full e-commerce order lifecycle as a **choreography saga** — catalog, inventory reservation, payment (HMAC webhook), shipping, and multi-channel notifications — built on the Transactional Outbox pattern with idempotent consumers and saga compensation.

## What it does

Runs an order from checkout to delivery as an asynchronous saga — the API commits state + an event in one transaction and returns immediately; background workers carry the rest:

1. **Auth & catalog** — register/login (argon2 + JWT); admin product CRUD with a Redis-cached public catalog.
2. **Order → reserve** — `POST /orders` writes the order + `order.created` in one tx; the inventory consumer reserves stock (or cancels on out-of-stock).
3. **Payment** — a mock provider calls back an HMAC-signed webhook; success commits the reservation, failure releases it and cancels the order (compensation).
4. **Shipping** — a fake carrier drives the shipment `pending → … → delivered`; the order ends `delivered`. Customers can cancel pre-ship (refund + restock).
5. **Notifications** — user-facing events fan out to channel providers (email real; SMS stubbed).
6. **Idempotency everywhere** — `Idempotency-Key` on mutating POSTs, HMAC webhook dedup, and per-consumer dedup make retries safe.

Architecture & diagrams: **[docs/architecture.md](./docs/architecture.md)** · **[event-flow.md](./docs/event-flow.md)** · **[state-machine.md](./docs/state-machine.md)** · **[compensation.md](./docs/compensation.md)**.

### The Transactional Outbox core (the foundation)

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

The Transactional Outbox pattern guarantees the event is never lost even if the broker is briefly down — the order and the event are written in the same DB transaction.

## Tech stack

Node 24 · TypeScript (ESM) · Fastify v5 · Drizzle ORM + PostgreSQL 17 · RabbitMQ (amqplib) · Redis (ioredis) · TypeBox + AJV validation · @fastify/jwt + argon2 · Nodemailer + Mailpit · Pino.

- Security: cors, helmet, Redis-backed rate-limit, sensible
- Observability: Prometheus + Grafana, OpenTelemetry + Jaeger, Sentry, health/readiness probes
- Quality: ESLint + Prettier, Husky + commitlint, Vitest + Testcontainers

Full rationale and versions: [`docs/tech-stack.md`](./docs/tech-stack.md).

## Design patterns applied

- Architecture: Layered (Route → Controller → Service → Repository), Modular Monolith, Repository, DTO, Dependency Injection (Fastify decorators)
- Messaging & saga: Producer/Consumer, Transactional Outbox, Choreography Saga + Compensation, Idempotent Consumer, Dead Letter Queue, Retry + exponential backoff, HMAC-signed webhooks
- Reliability & ops: compare-and-set state machines, Graceful Shutdown, Health/Readiness, Structured Logging + Correlation ID, 12-Factor config

## Project structure

```
src/
├── modules/{auth,users,products,orders,payments,shipping,notifications}/
│                                  # route → controller → service → repository + saga consumers
├── infra/{db,mq,mail,notify,redis,telemetry,http}/
├── plugins/                       # env, security, jwt, redis, idempotency, swagger, error-handler...
├── workers/                       # background worker: all saga consumers + outbox relay + reaper
├── config/                        # env schema (validated at boot)
├── app.ts                         # build Fastify instance (no listen)
└── server.ts                      # listen + graceful shutdown
```

## Getting started

Prereqs: Node 24 (`nvm use`) and Docker.

```bash
cp .env.example .env    # fill JWT_SECRET (32+ chars); defaults work for the rest locally
npm install

docker compose up -d    # full local stack (Postgres, RabbitMQ, Mailpit, Prometheus, Grafana, Jaeger)
npm run db:migrate      # apply Drizzle migrations

npm run dev             # start API (hot reload via tsx) → http://localhost:3000
npm run dev:worker      # in another shell: start the email worker
```

| Service        | URL                                                              |
| -------------- | ---------------------------------------------------------------- |
| API            | http://localhost:3000 (`/docs`, `/health`, `/ready`, `/metrics`) |
| Mailpit inbox  | http://localhost:8025                                            |
| RabbitMQ admin | http://localhost:15672                                           |
| Jaeger traces  | http://localhost:16686                                           |
| Prometheus     | http://localhost:9090                                            |
| Grafana        | http://localhost:3001                                            |

### Scripts

| Script                                             | Purpose                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| `npm run dev` / `dev:worker`                       | Hot-reload API / email worker                    |
| `npm run build`                                    | Clean + compile (`rimraf` → `tsc` → `tsc-alias`) |
| `npm run lint` / `format`                          | ESLint (typed) / Prettier                        |
| `npm run typecheck`                                | `tsc --noEmit`                                   |
| `npm test` / `test:cov`                            | Vitest / with coverage                           |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit migrations / Studio                  |

## Container image

Each release builds a single image and publishes it to **both** GitHub Container Registry and Docker Hub with identical tags (`:X.Y.Z`, `:X.Y`, `:latest`, `:sha-<short>`):

```bash
docker pull ghcr.io/ndgkhoa/order-management-api:latest   # GitHub Container Registry
docker pull ndgkhoa/order-management-api:latest           # Docker Hub
```

## License

[MIT](./LICENSE) © 2026 ndgkhoa
