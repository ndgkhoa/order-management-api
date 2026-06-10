# Phase 02 — Local Infra (docker-compose + Dockerfile)

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 01](./phase-01-scaffolding-and-tooling.md) (`.dockerignore`, scripts).

## Overview

- **Priority:** P1 · **Status:** Pending
- **Description:** `docker-compose.yml` with all services (api, email-worker, postgres:17, rabbitmq:4-management, mailpit, prometheus, grafana, jaeger) + multi-stage Dockerfile (node:24-alpine, non-root, HEALTHCHECK; ONE image → api OR worker by CMD) + `prometheus.yml`.

## Key Insights

- ONE image, two roles: `command:` override picks `node dist/server.js` vs `node dist/workers/email-worker.js` (DRY).
- During dev you may run app via `npm run dev` on host and only infra in compose — provide a `compose` that supports both. Keep app/worker services using built image for the "prod-like" path.
- RabbitMQ management UI :15672 (guest/guest). Mailpit UI :8025, SMTP :1025. Jaeger UI :16686. Grafana :3001 (avoid clashing api 3000). Prometheus :9090.
- Healthchecks gate `depends_on: condition: service_healthy` so api waits for pg + rabbit.

## Requirements

**Functional:** `docker compose up` brings full stack healthy; api reachable; worker connects to rabbit.
**Non-functional:** non-root container, small alpine image, reproducible.

## Architecture

```
compose network:
 api(3000) ─┬─ postgres(5432)
 worker ────┤
            ├─ rabbitmq(5672/15672)
 worker ────┘
 api/worker ─ jaeger(4318 otlp-http /16686 ui)
 prometheus(9090) ─ scrapes api:3000/metrics ─ grafana(3001)
 api/worker ─ mailpit(1025 smtp /8025 ui)
```

## Related Code Files

**Create:** `Dockerfile`, `docker-compose.yml`, `prometheus.yml`, `.env` (local, git-ignored), optional `grafana/provisioning/datasources/prometheus.yml`.

## Implementation Steps

1. **Multi-stage Dockerfile:**
   ```dockerfile
   # --- deps ---
   FROM node:24-alpine AS deps
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   # --- build ---
   FROM node:24-alpine AS build
   WORKDIR /app
   COPY --from=deps /app/node_modules ./node_modules
   COPY . .
   RUN npm run build && npm prune --omit=dev
   # --- runner ---
   FROM node:24-alpine AS runner
   ENV NODE_ENV=production
   WORKDIR /app
   RUN addgroup -S app && adduser -S app -G app
   COPY --from=build /app/node_modules ./node_modules
   COPY --from=build /app/dist ./dist
   COPY --from=build /app/package.json ./
   COPY --from=build /app/drizzle ./drizzle
   USER app
   EXPOSE 3000
   HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
     CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
   CMD ["node", "dist/server.js"]
   ```
2. **docker-compose.yml** key services:
   ```yaml
   services:
     postgres:
       image: postgres:17-alpine
       environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: orders }
       ports: ['5432:5432']
       healthcheck:
         { test: ['CMD-SHELL', 'pg_isready -U app -d orders'], interval: 5s, retries: 10 }
     rabbitmq:
       image: rabbitmq:4-management
       ports: ['5672:5672', '15672:15672']
       healthcheck:
         { test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'], interval: 10s, retries: 10 }
     mailpit:
       image: axllent/mailpit
       ports: ['1025:1025', '8025:8025']
     jaeger:
       image: jaegertracing/all-in-one:latest
       ports: ['16686:16686', '4318:4318'] # OTLP http
     prometheus:
       image: prom/prometheus
       volumes: ['./prometheus.yml:/etc/prometheus/prometheus.yml']
       ports: ['9090:9090']
     grafana:
       image: grafana/grafana
       ports: ['3001:3000']
     api:
       build: .
       command: ['node', 'dist/server.js']
       env_file: .env
       environment:
         DATABASE_URL: postgres://app:app@postgres:5432/orders
         RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
         SMTP_HOST: mailpit
         OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318
       ports: ['3000:3000']
       depends_on:
         postgres: { condition: service_healthy }
         rabbitmq: { condition: service_healthy }
     email-worker:
       build: .
       command: ['node', 'dist/workers/email-worker.js']
       env_file: .env
       environment:
         {
           DATABASE_URL: ...,
           RABBITMQ_URL: ...,
           SMTP_HOST: mailpit,
           OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318,
         }
       depends_on:
         postgres: { condition: service_healthy }
         rabbitmq: { condition: service_healthy }
   ```
3. **prometheus.yml:** scrape job `api` target `api:3000` path `/metrics`, 5s interval.
4. Grafana datasource provisioning → Prometheus `http://prometheus:9090` (optional now).
5. Document: dev loop = `docker compose up -d postgres rabbitmq mailpit jaeger prometheus grafana` then host `npm run dev` + `npm run dev:worker` (fast). Full prod-like = `docker compose up --build`.

## Todo

- [ ] Multi-stage Dockerfile (non-root, HEALTHCHECK, drizzle copied)
- [ ] docker-compose all 8 services + healthchecks + depends_on
- [ ] prometheus.yml scrape config
- [ ] grafana datasource provisioning (optional)
- [ ] `.env` local + verify `docker compose config` valid

## Success Criteria

- `docker compose up --build` → all healthy; RabbitMQ UI :15672, Mailpit :8025, Jaeger :16686, Grafana :3001 reachable.
- One image runs as api or worker depending on `command`.

## Risk Assessment

- Migrations not yet run (phase 03) — api `/ready` may fail until then; acceptable this phase (infra only).
- Port clashes (grafana mapped 3001). Document.

## Security Considerations

- Non-root `app` user. Default guest/dev creds are LOCAL ONLY — note in README they must change in prod. `.env` git-ignored.

## Next Steps

Phase 03 adds DB schema + migration; `drizzle` dir referenced by Dockerfile must exist before prod build.
