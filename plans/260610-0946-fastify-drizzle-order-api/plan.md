---
title: 'Fastify + Drizzle Order API (Transactional Outbox + RabbitMQ)'
description: 'Production-grade learning REST API: register/login + async order email via Transactional Outbox → RabbitMQ → Email Worker.'
status: pending
priority: P2
effort: ~40h (10 phases)
branch: main
tags: [fastify, drizzle, rabbitmq, outbox, devops, observability, learning]
created: 2026-06-10
---

# Fastify + Drizzle Order API — Implementation Plan

Learning-grade but production-shaped REST API. Goal: master **Fastify v5, RabbitMQ, DevOps, senior backend patterns**.
Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md). Stack is LOCKED — do not re-decide.

## Core async flow (the point of the whole project)

```
[Client] POST /orders ──▶ [Fastify API]
                            │ ONE db transaction:
                            │   INSERT order  +  INSERT outbox_messages(order.created)
                            ▼
                          200 OK (immediate — does NOT wait for email)
                            │
                  [Outbox Relay] poll unsent outbox rows
                            │ publish "order.created" (persistent)
                            ▼
                 [RabbitMQ] exchange order.events ──▶ queue order.created.email ──(fail x N)──▶ DLX ▶ DLQ
                            │
                  [Email Worker] consume idempotently (processed_messages guard)
                            │ Nodemailer
                            ▼
                        [Mailpit] (dev SMTP + UI)
```

Trace context (`traceparent`) propagates API → RabbitMQ → Worker via OTel amqplib instrumentation.

## Phases (status: ALL Pending — do not auto-complete)

| #   | Phase                                                                        | Status  | Description                                                                                 | Depends |
| --- | ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ------- |
| 01  | [Scaffolding & tooling](phase-01-scaffolding-and-tooling.md)                 | Pending | package.json, tsconfig, ESLint/Prettier, Husky, @fastify/env, folder skeleton               | —       |
| 02  | [Local infra (compose + Dockerfile)](phase-02-local-infra-docker-compose.md) | Pending | docker-compose (api,worker,pg,rabbit,mailpit,prom,grafana,jaeger) + multi-stage Dockerfile  | 01      |
| 03  | [DB layer (Drizzle)](phase-03-db-layer-drizzle.md)                           | Pending | pg Pool singleton, schema (users/orders/outbox/processed), drizzle-kit generate+migrate     | 02      |
| 04  | [Fastify core + health](phase-04-fastify-core-and-health.md)                 | Pending | app.ts builder, plugins, correlation id, /health + /ready, graceful shutdown                | 03      |
| 05  | [Auth + Users module](phase-05-auth-and-users-module.md)                     | Pending | register (argon2), login (JWT), authenticate preHandler, TypeBox schemas                    | 04      |
| 06  | [Orders + Transactional Outbox](phase-06-orders-and-transactional-outbox.md) | Pending | create-order writes order+outbox in 1 tx; outbox relay polling publisher                    | 05      |
| 07  | [RabbitMQ + Email Worker](phase-07-rabbitmq-and-email-worker.md)             | Pending | amqplib singleton+reconnect, topology+DLX, idempotent consumer, retry/backoff, mail adapter | 06      |
| 08  | [Observability](phase-08-observability.md)                                   | Pending | fastify-metrics /metrics, OTel→Jaeger, Sentry adapter, correlation id in logs+traces        | 07      |
| 09  | [Testing](phase-09-testing.md)                                               | Pending | Vitest unit + app.inject() API tests + Testcontainers full-flow integration                 | 07      |
| 10  | [CI/CD & deploy docs](phase-10-cicd-and-deploy-docs.md)                      | Pending | GitHub Actions (lint→typecheck→test→build→GHCR), deployment guide, README                   | 09      |

## Key dependencies (linear-ish)

01 → 02 → 03 → 04 → 05 → 06 → 07 → {08, 09} → 10.
08 (observability) and 09 (testing) can run in parallel after 07.

## Conventions (all phases)

- Files kebab-case, < 200 LOC, layered Route→Controller→Service→Repository.
- 12-Factor config via `@fastify/env` (validated at boot). No secrets in git.
- DI through Fastify decorators/plugins. Singletons: db pool, logger, mq connection.
- **Code style: functional factory functions** (`makeUsersService(repo)`, `makeUsersRepository(db)`) with closure DI — NO classes for services/repositories. Wire instances in a Fastify plugin via `app.decorate`. Idiomatic Fastify, easy to test (pass deps).
- **API responses:** success returns the resource DIRECTLY (no envelope). Errors = **RFC 7807 Problem Details** (`application/problem+json`) + `requestId`, via one global `setErrorHandler` (phase 04).
- Path aliases `@/ @config/ @infra/ @modules/ @plugins/` (tsc-alias build, vite-tsconfig-paths tests). Build cleans `dist/` with rimraf.
- Audience is LEARNING — every phase file has heavy comments + "why" notes.
