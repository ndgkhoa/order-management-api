# Phase 10 — CI/CD & Deployment Docs

## Context Links

- Source of truth: [`docs/tech-stack.md`](../../docs/tech-stack.md) · Overview: [`plan.md`](./plan.md)
- Depends on: [Phase 09](./phase-09-testing.md) (tests gate CI), [Phase 02](./phase-02-local-infra-docker-compose.md) (Dockerfile).

## Overview

- **Priority:** P2 · **Status:** Pending
- **Description:** GitHub Actions (`.github/workflows/ci.yml`: install → ESLint → typecheck → test w/ Testcontainers → docker build → push GHCR). `docs/deployment-guide.md` (Fly.io easy → VPS + docker compose + Caddy/Traefik TLS → Kubernetes + Helm stretch). Project `README.md` with quickstart.

## Key Insights

- One pipeline, ordered gates: cheap fast checks first (lint, typecheck), then tests (Docker-in-runner for Testcontainers), then build+push only on `main`/tags.
- GHCR image is the single deploy artifact; same image runs api or worker (CMD override) → all deploy targets reuse it (DRY).
- Migrations run as a deploy step (`drizzle-kit migrate` or a `migrate.js`) BEFORE app starts — document per target.
- Deploy ladder by difficulty: Fly.io (managed, easiest) → self-managed VPS + compose + reverse proxy TLS → K8s + Helm (stretch). Don't build K8s now (YAGNI) — just document.

## Requirements

**Functional:** PR → lint+typecheck+test run; push to main → image built+pushed to GHCR. Deploy guide reproducible.
**Non-functional:** secrets via GH/host secret stores, never in repo; cached npm install.

## Architecture

```
ci.yml:
  job test: checkout → setup-node 24 (cache npm) → npm ci → lint → typecheck → test (Testcontainers, Docker on runner)
  job build (needs test, on main/tag): docker/build-push-action → ghcr.io/<owner>/order-api:sha,latest
deploy (docs only): pull image → run migrations → start api + worker → reverse proxy TLS
```

## Related Code Files

**Create:**

- `.github/workflows/ci.yml`
- `docs/deployment-guide.md`
- `README.md` (quickstart)
- (optional) `fly.toml`, `scripts/migrate.ts`
  **Modify:** none (uses phase 02 Dockerfile).

## Implementation Steps

1. **ci.yml**:
   ```yaml
   name: CI
   on: { push: { branches: [main] }, pull_request: {} }
   jobs:
     test:
       runs-on: ubuntu-latest   # Docker available → Testcontainers works
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 24, cache: npm }
         - run: npm ci
         - run: npm run lint
         - run: npm run typecheck
         - run: npm run test           # spins pg/rabbit/mailpit via Testcontainers
     build-and-push:
       needs: test
       if: github.ref == 'refs/heads/main'
       runs-on: ubuntu-latest
       permissions: { contents: read, packages: write }
       steps:
         - uses: actions/checkout@v4
         - uses: docker/login-action@v3
           with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
         - uses: docker/build-push-action@v6
           with:
             push: true
             tags: ghcr.io/${{ github.repository }}:latest,ghcr.io/${{ github.repository }}:${{ github.sha }}
   ```
2. **deployment-guide.md** sections:
   - **Migrations:** `node --env-file=.env scripts/migrate.ts` (drizzle `migrate()`), run before app start on every deploy.
   - **(A) Fly.io (easiest):** `fly launch`, set secrets (`fly secrets set DATABASE_URL=... RABBITMQ_URL=... JWT_SECRET=...`), managed Postgres; deploy api + a second process/app for worker (`[processes] app = "node dist/server.js"`, `worker = "node dist/workers/email-worker.js"`). External RabbitMQ (CloudAMQP).
   - **(B) VPS + docker compose + TLS:** copy compose (prod variant: no published DB ports, real creds via env), add **Caddy** (auto-HTTPS) or **Traefik** reverse proxy in front of api; `docker compose pull && up -d`; run migrate step. Backups for pg volume.
   - **(C) Kubernetes + Helm (stretch):** Deployments for api + worker (same image, different command), Service + Ingress (cert-manager TLS), managed Postgres + RabbitMQ (operator/cloud), liveness `/health` + readiness `/ready` probes, HPA on CPU/RPS. Migrations as a `Job`/initContainer.
3. **README.md** quickstart: prereqs (Node 24, Docker), `cp .env.example .env`, `docker compose up -d <infra>`, `npm i`, `npm run db:migrate`, `npm run dev` + `npm run dev:worker`, hit `/docs`, POST /orders, view Mailpit :8025, Jaeger :16686, Grafana :3001. Include the async flow diagram + "what each pattern teaches" pointers.
4. Add status badge + license note (optional).

## Todo

- [ ] .github/workflows/ci.yml (test gate → GHCR build/push on main)
- [ ] scripts/migrate.ts (drizzle migrate) for deploy
- [ ] docs/deployment-guide.md (Fly.io → VPS+TLS → K8s/Helm)
- [ ] README.md quickstart + flow diagram + pattern map
- [ ] (optional) fly.toml with api + worker processes
- [ ] verify CI green on a PR

## Success Criteria

- PR triggers lint+typecheck+test; failing test blocks merge.
- Push to main publishes GHCR image (api+worker in one image).
- Deployment guide lets a reader deploy via at least the Fly.io path; README quickstart works end-to-end locally.

## Risk Assessment

- Testcontainers in CI needs Docker — ubuntu-latest provides it; document if self-hosted runner lacks it.
- GHCR perms: ensure `packages: write` + repo visibility settings.
- Migrations must precede app boot — emphasize ordering to avoid "relation does not exist".

## Security Considerations

- All creds via GH Actions secrets / host secret manager — never committed.
- Prod compose: do NOT publish Postgres/RabbitMQ ports publicly; TLS at proxy; change default creds; non-root container (phase 02).

## Next Steps

Project complete. Stretch: under-pressure load shedding, Redis distributed rate-limit/refresh-token, Circuit Breaker, ArgoCD GitOps, HPA autoscale (tech-stack stretch list).
