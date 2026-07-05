# order-management-api

[![CI](https://github.com/ndgkhoa/order-management-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ndgkhoa/order-management-api/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ndgkhoa/order-management-api/actions/workflows/codeql.yml/badge.svg)](https://github.com/ndgkhoa/order-management-api/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/ndgkhoa/order-management-api?sort=semver)](https://github.com/ndgkhoa/order-management-api/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A production-grade, event-driven order backend. Runs the e-commerce order lifecycle as an asynchronous choreography saga built on the Transactional Outbox pattern: catalog, inventory reservation, payment, shipping, and multi-channel notifications — all with idempotent consumers and compensation on failure.

## What it does

The API commits state + an event in one database transaction and returns immediately. Background workers consume events asynchronously to drive orders to completion:

1. **Auth & catalog** — JWT login; admin product CRUD with a Redis-cached public catalog
2. **Order → reserve** — `POST /orders` writes order + `order.created` event in one tx; inventory consumer reserves stock or cancels on out-of-stock
3. **Payment** — mock provider posts an HMAC-signed webhook; success commits reservation, failure releases stock and compensates
4. **Shipping** — fake carrier drives shipment progression; customer can cancel pre-ship
5. **Notifications** — events fan out to email + SMS channel providers
6. **Idempotency** — `Idempotency-Key` header, HMAC webhook replay detection, and per-consumer dedup make retries safe

## Tech stack

**Node 24 · TypeScript ESM · Fastify v5 · Drizzle ORM + PostgreSQL 17 · RabbitMQ · Redis · TypeBox + AJV · @fastify/jwt + argon2 · Nodemailer · Pino · OpenTelemetry · Prometheus/Grafana · Vitest + Testcontainers**

See [docs/codebase-summary.md](./docs/codebase-summary.md) for full stack details.

## Quick start

```bash
# Setup
cp .env.example .env
npm install

# Start the full stack
docker compose up -d
npm run db:migrate

# Run the API and the worker in separate shells
npm run dev
npm run dev:worker
```

API on http://localhost:3000 — Swagger at `/docs`, plus `/health`, `/ready`, `/metrics`.

| Service        | URL                    |
| -------------- | ---------------------- |
| API / OpenAPI  | http://localhost:3000  |
| Mailpit inbox  | http://localhost:8025  |
| RabbitMQ admin | http://localhost:15672 |
| Jaeger traces  | http://localhost:16686 |
| Prometheus     | http://localhost:9090  |
| Grafana        | http://localhost:3001  |

**Scripts:** `npm run {dev, build, lint, typecheck, test, db:generate, db:migrate, db:studio}`

## Architecture

Two processes, one image:

- **API** — HTTP routes, state writes, outbox relay → RabbitMQ
- **Worker** — async saga consumers, idempotent event handlers

**Core pattern:** Transactional Outbox + at-least-once delivery + idempotent consumers = zero event loss, safe retries.

**Design:** Layered 5-layer modules (route → controller → service → repository → schema), modular monolith, event-driven choreography saga with compare-and-set state machines and compensation on failure.

## Key features

- **Choreography saga** with compensation
- **Transactional Outbox** — state + event in one DB tx, relay publishes to broker
- **Idempotency** — three layers (consumer dedup, HTTP Idempotency-Key, webhook replay detection)
- **RBAC** — multi-role, permission-based access control
- **HMAC-signed webhooks** — payment provider integration pattern
- **Observability** — OpenTelemetry traces, Prometheus metrics, Sentry error tracking
- **Testable** — real infrastructure (Testcontainers: Postgres, RabbitMQ, Redis, Mailpit)

## Documentation

- **[docs/project-overview-pdr.md](./docs/project-overview-pdr.md)** — problem statement, goals, scope, key decisions
- **[docs/codebase-summary.md](./docs/codebase-summary.md)** — directory layout, module responsibilities, tech stack rationale
- **[docs/system-architecture.md](./docs/system-architecture.md)** — component diagram, saga event flow, state machines, compensation, idempotency layers
- **[docs/code-standards.md](./docs/code-standards.md)** — enforced patterns: 5-layer modules, factories, schema declaration, type SSoT, ESM conventions
- **[docs/project-roadmap.md](./docs/project-roadmap.md)** — current status, completed features, next steps
- **[docs/deployment-guide.md](./docs/deployment-guide.md)** — migration gate, three deployment tiers (Fly.io, VPS+compose, Kubernetes)

## License

[MIT](./LICENSE) © 2026 ndgkhoa
