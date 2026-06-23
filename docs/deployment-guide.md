# Deployment Guide

The CI/CD pipeline's job ends at **publishing the image to GHCR and Docker Hub** (see the release flow below).
**Deploying** = pulling that image and running it. The same image runs the **API**
(`node dist/server.js`) or the **email worker** (`node dist/workers/email-worker.js`) — the command
is overridden per role.

Three tiers, easiest first: **(A) Fly.io** → **(B) VPS + docker compose + TLS** → **(C) Kubernetes + Helm**.

## Where the image comes from

Same tags are pushed to both `ghcr.io/ndgkhoa/order-management-api` and `docker.io/ndgkhoa/order-management-api`.

| Tag                                                   | Built by                                                                              | Use                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `ghcr.io/ndgkhoa/order-management-api:X.Y.Z` / `:X.Y` | [`release-please.yml`](../.github/workflows/release-please.yml) when a release is cut | **production**            |
| `…:latest`                                            | same release build                                                                    | latest stable             |
| `…:sha-<short>`                                       | same release build                                                                    | immutable, exact rollback |

Images are built **only when a release is cut** — push to `develop` just runs CI/tests, it does not
publish an image. Releases come from `release-please`: merge its release PR → tag `vX.Y.Z` →
versioned image. Pin production to `:X.Y.Z` (or `:sha-…`).

---

## 0. Migrations — run BEFORE the app starts (every deploy)

The schema must exist before API/worker boot, or you get `relation "..." does not exist`.

`drizzle-kit` is a **dev dependency** and is pruned from the runtime image, so we don't use
`npm run db:migrate` in prod. The image bakes a `drizzle-orm` migrator
([`src/infra/db/migrate.ts`](../src/infra/db/migrate.ts) → `dist/infra/db/migrate.js`) that applies
every SQL file in `./drizzle` using only `DATABASE_URL`. It is idempotent (safe to re-run):

```bash
node dist/infra/db/migrate.js     # run to exit 0, THEN start api + worker
```

Make this a **gate**: run it as a one-off task / release command / Job; start the app only after it
succeeds.

### Required environment

Secrets come from the platform's secret store — **never** committed
(full list + defaults in [`.env.example`](../.env.example)):

| Var                           | Notes                                          |
| ----------------------------- | ---------------------------------------------- |
| `DATABASE_URL`                | Postgres connection string (managed or in-net) |
| `RABBITMQ_URL`                | amqp(s) broker URL                             |
| `JWT_SECRET`                  | **32+ chars**, unique per environment          |
| `SMTP_HOST` / `SMTP_PORT`     | real SMTP (SES/Mailgun/…) — not Mailpit        |
| `MAIL_FROM`                   | sender address                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP collector (optional)                 |
| `SENTRY_DSN`                  | error tracking (optional)                      |

`NODE_ENV=production` is baked into the image.

---

## (A) Fly.io — managed, easiest

Best for getting live fast. Use **managed Postgres** (Fly Postgres / Neon) and **managed RabbitMQ**
(CloudAMQP) — don't self-host the broker.

```bash
fly launch --no-deploy            # generates fly.toml (template below)
fly secrets set \
  DATABASE_URL='postgres://...' \
  RABBITMQ_URL='amqps://...cloudamqp.com/vhost' \
  JWT_SECRET='<32+ char secret>' \
  SMTP_HOST='email-smtp.region.amazonaws.com' SMTP_PORT='587' \
  MAIL_FROM='orders@yourdomain.com'

fly deploy --image ghcr.io/ndgkhoa/order-management-api:X.Y.Z   # or build from the Dockerfile
```

`fly.toml` — **two processes from one image**, with the migration gate as `release_command`:

```toml
app = "order-management-api"
primary_region = "sin"

[build]
  image = "ghcr.io/ndgkhoa/order-management-api:X.Y.Z"   # or: dockerfile = "Dockerfile"

[deploy]
  release_command = "node dist/infra/db/migrate.js" # runs once per deploy, before going live

[processes]
  app    = "node dist/server.js"
  worker = "node dist/workers/email-worker.js"

[http_service]                    # fronts the API process only — the worker has no HTTP server
  internal_port = 3000
  force_https = true
  processes = ["app"]
  [[http_service.checks]]
    method = "GET"
    path = "/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

`release_command` is Fly's built-in migration gate — runs with your secrets and aborts the release
on non-zero exit. Readiness can point at `/ready`.

---

## (B) VPS + docker compose + reverse-proxy TLS

Self-managed single VM. The repo ships a **prod overlay**
([`docker-compose.prod.yml`](../docker-compose.prod.yml)) that hardens the base: restart policies,
memory limits, Grafana locked down, **no published Postgres/RabbitMQ ports**, credentials
**required** (`${VAR:?}` aborts startup if missing).

1. **Provision** a small VM (2 vCPU / 2–4 GB), install Docker + the compose plugin, point a DNS A
   record at it.
2. **Secrets:** create `.env.prod` on the host (`chmod 600`, not in git). For managed DB/broker, set
   `DATABASE_URL` / `RABBITMQ_URL` and drop the `postgres`/`rabbitmq` services from the overlay (the
   file documents this). Point api/worker `image:` at `ghcr.io/ndgkhoa/order-management-api:X.Y.Z`.
3. **Pull → migrate → start** (migration gate first):

   ```bash
   export C="docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml"
   $C pull
   $C run --rm api node dist/infra/db/migrate.js      # gate: must exit 0
   $C up -d
   ```

4. **TLS via reverse proxy.** The API listens on `:3000` inside the compose network and is **not**
   published publicly. Put **Caddy** (auto-HTTPS, simplest) in front — add it as a service that
   publishes only `:80`/`:443` on the same network:

   ```caddyfile
   api.yourdomain.com {
       reverse_proxy api:3000
   }
   ```

   Caddy provisions + renews Let's Encrypt certs automatically. **Traefik** is the alternative if you
   want label-based routing. Infra UIs (Grafana/Jaeger/Prometheus) stay unpublished — reach them via
   SSH tunnel or an authenticated proxy route.

5. **Backups:** snapshot the `pgdata` volume (`pg_dump` on a cron, ship offsite). Don't skip this.

---

## (C) Kubernetes + Helm — stretch

Only worth it at multi-node scale. Sketch:

- **Two Deployments**, same image, different `command`: `api` (replicas ≥ 2) and `email-worker`.
- **Service + Ingress** for the API; TLS via **cert-manager** + a `ClusterIssuer` (Let's Encrypt).
- **Managed Postgres + RabbitMQ** (cloud or an operator) — don't run stateful infra by hand.
- **Probes** on the API: liveness `GET /health`, readiness `GET /ready` (the worker has no HTTP —
  use an exec probe or none).
- **Migrations** as a Helm pre-install/pre-upgrade **Job** (or initContainer) running
  `node dist/infra/db/migrate.js` — the chart blocks rollout until it succeeds.
- **HPA** on the API by CPU (or RPS via custom metrics). Secrets via a `Secret` / external-secrets.

---

## Deploy checklist (all tiers)

- [ ] Secrets in the platform store, none in git (`JWT_SECRET` ≥ 32 chars, unique per env)
- [ ] `node dist/infra/db/migrate.js` runs and exits 0 **before** api/worker start
- [ ] API reachable only through the TLS reverse proxy; Postgres/RabbitMQ ports not public
- [ ] Both roles running (api + email-worker) from the **same** pinned image tag
- [ ] `/health` + `/ready` green; metrics/traces flowing if collectors configured
- [ ] Postgres volume backups scheduled (self-hosted paths)
