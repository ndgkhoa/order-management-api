# fastify-drizzle

[![CI](https://github.com/ndgkhoa/fastify-drizzle/actions/workflows/ci.yml/badge.svg)](https://github.com/ndgkhoa/fastify-drizzle/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ndgkhoa/fastify-drizzle/actions/workflows/codeql.yml/badge.svg)](https://github.com/ndgkhoa/fastify-drizzle/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/ndgkhoa/fastify-drizzle?sort=semver)](https://github.com/ndgkhoa/fastify-drizzle/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A production-shaped **learning** REST API. The goal is to learn, by building something real:
**Fastify v5**, **RabbitMQ** (async messaging done right), **DevOps**, and the **design patterns senior backend engineers actually use**.

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

**Prereqs:** Node 24 (`nvm use`) and Docker.

```bash
cp .env.example .env    # fill JWT_SECRET (32+ chars); defaults work for the rest locally
npm install

docker compose up -d    # full local stack (Postgres, RabbitMQ, Mailpit, Prometheus, Grafana, Jaeger)
npm run db:migrate      # apply Drizzle migrations

npm run dev             # start API (hot reload via tsx) → http://localhost:3000
npm run dev:worker      # in another shell: start the email worker
```

Then open the API docs at **http://localhost:3000/docs**, register + log in, `POST /orders`, and watch the email land in **Mailpit** at http://localhost:8025.

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

## License

[MIT](./LICENSE) © 2026 ndgkhoa
