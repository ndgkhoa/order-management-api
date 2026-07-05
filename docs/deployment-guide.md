# Deployment Guide

Deploying order-management-api means running the migration gate first, then starting two processes (API + worker) from the same image. This guide covers three tiers: Fly.io (easiest), VPS + Docker Compose (self-managed), and Kubernetes (stretch goal).

## Overview

- **One Docker image**, two commands:
  - `node dist/server.js` → API (HTTP, port 3000)
  - `node dist/workers/worker.js` → Background worker (no HTTP)
- **Migration gate:** `node dist/infra/db/migrate.js` (idempotent, must run before either process starts)
- **Images published:** `ghcr.io/ndgkhoa/order-management-api` + `docker.io/ndgkhoa/order-management-api`
- **Tagging:** `:X.Y.Z` (release), `:latest` (stable), `:sha-<short>` (immutable commit hash)

## Pre-Deployment Checklist

Before deploying to any environment:

- [ ] Secrets stored in platform secret store (not `.env` in git)
- [ ] All required environment variables set (see table below)
- [ ] `JWT_SECRET` is 32+ characters, unique per environment
- [ ] `PAYMENT_WEBHOOK_URL` matches your production domain
- [ ] Database backups configured (if self-hosted)
- [ ] Health/readiness probes configured
- [ ] TLS reverse proxy in front of API (never expose HTTP directly)

## Environment Variables

### Required

| Variable              | Example                                        | Notes                                          |
| --------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`        | `postgresql://user:pass@host:5432/orders_prod` | Postgres connection string (managed or in-net) |
| `RABBITMQ_URL`        | `amqps://user:pass@broker.cloudamqp.com/vhost` | RabbitMQ broker URL (amqp or amqps)            |
| `JWT_SECRET`          | `(32+ random chars)`                           | **Unique per environment; keep secure**        |
| `PAYMENT_WEBHOOK_URL` | `https://yourdomain.com/webhooks/payment`      | Public URL payment provider posts to           |

### Optional (Recommended for Production)

| Variable                      | Example                              | Default               | Notes                                     |
| ----------------------------- | ------------------------------------ | --------------------- | ----------------------------------------- |
| `SMTP_HOST`                   | `email-smtp.us-east-1.amazonaws.com` | `localhost`           | Real SMTP server (SES, Mailgun, etc.)     |
| `SMTP_PORT`                   | `587`                                | `1025`                | SMTP port (usually 25, 587, 465)          |
| `SMTP_USER`                   | `your-ses-user`                      | —                     | SMTP authentication (if required)         |
| `SMTP_PASS`                   | `your-ses-password`                  | —                     | SMTP password                             |
| `MAIL_FROM`                   | `orders@yourdomain.com`              | `noreply@example.com` | Sender email address                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://your-otel-collector:4318`   | (disabled)            | OpenTelemetry collector (optional)        |
| `SENTRY_DSN`                  | `https://xxx@sentry.io/xxx`          | (disabled)            | Sentry error tracking (optional)          |
| `NODE_ENV`                    | `production`                         | `production`          | (Baked into image; do not override)       |
| `LOG_LEVEL`                   | `info`                               | `info`                | Pino log level (debug, info, warn, error) |

---

## Tier A: Fly.io (Managed, Easiest)

Best for getting live fast. Fly manages Postgres, load balancing, and TLS automatically.

### 1. Use Managed Services

- **Database:** Fly Postgres (or Neon, PlanetScale) — managed, backed up, replicated
- **Broker:** CloudAMQP (managed RabbitMQ) — monitored, scaled
- **Redis:** Fly Redis (optional; use if not deploying locally)

### 2. Setup

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Create app (no deploy yet)
fly launch --no-deploy
# This generates fly.toml

# Create Postgres database
fly postgres create --name orders-db
# This returns DATABASE_URL; save it

# Setup RabbitMQ (CloudAMQP or Fly broker)
# Option A: Use CloudAMQP (external)
# Sign up at cloudamqp.com, copy RABBITMQ_URL

# Option B: Fly broker (if available in your region)
fly broker-machines create rabbitmq

# Set secrets
fly secrets set \
  DATABASE_URL='postgres://user:pass@fly-postgres.internal:5432/orders' \
  RABBITMQ_URL='amqps://user:pass@cloudamqp.com/vhost' \
  JWT_SECRET='generate-32-char-secret-here' \
  SMTP_HOST='email-smtp.us-east-1.amazonaws.com' \
  SMTP_PORT='587' \
  SMTP_USER='your-ses-user' \
  SMTP_PASS='your-ses-password' \
  MAIL_FROM='orders@yourdomain.com' \
  PAYMENT_WEBHOOK_URL='https://yourdomain.com/webhooks/payment'

# Deploy (uses release_command to run migration)
fly deploy --image ghcr.io/ndgkhoa/order-management-api:X.Y.Z
```

### 3. fly.toml Configuration

```toml
app = "order-management-api"
primary_region = "sin"        # Singapore; choose your region
console_command = "/bin/sh"

[build]
  image = "ghcr.io/ndgkhoa/order-management-api:X.Y.Z"   # or: dockerfile = "Dockerfile"

[deploy]
  # Migration runs once per deploy, BEFORE app starts
  release_command = "node dist/infra/db/migrate.js"
  strategy = "canary"

[processes]
  app    = "node dist/server.js"
  worker = "node dist/workers/worker.js"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  processes = ["app"]           # Only API handles HTTP

  [[http_service.checks]]
    method = "GET"
    path = "/health"

  [[http_service.checks]]
    method = "GET"
    path = "/ready"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[[processes.app]]
  size = "shared-cpu-1x"
  memory = "512mb"
  auto_stop_machines = true

[[processes.worker]]
  size = "shared-cpu-1x"
  memory = "512mb"
  auto_stop_machines = true
```

### 4. Post-Deployment

- Monitor in Fly dashboard: https://fly.io/dashboard
- Check logs: `fly logs`
- Scale processes: `fly scale count app=2` (API scales horizontally)
- Health: `curl https://yourdomain.com/ready`

---

## Tier B: VPS + Docker Compose + Caddy (Self-Managed)

For full control. You manage Postgres, RabbitMQ, and TLS.

### 1. Provision VM

- **Size:** 2 vCPU, 4–8 GB RAM (adequate for dev/staging; larger for production)
- **OS:** Ubuntu 22.04 LTS
- **Setup:**
  ```bash
  sudo apt update && sudo apt upgrade -y
  sudo apt install -y docker.io docker-compose-plugin git
  sudo usermod -aG docker $USER
  newgrp docker
  ```

### 2. Prepare Environment

Clone repo and setup secrets:

```bash
git clone https://github.com/ndgkhoa/order-management-api.git
cd order-management-api

# Create .env.prod (never commit!)
cat > .env.prod <<'EOF'
DATABASE_URL=postgresql://orders_user:strong_password@postgres:5432/orders_db
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/
RABBITMQ_DEFAULT_USER=guest
RABBITMQ_DEFAULT_PASS=guest
JWT_SECRET=generate-32-char-secret-here
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-ses-user
SMTP_PASS=your-ses-password
MAIL_FROM=orders@yourdomain.com
PAYMENT_WEBHOOK_URL=https://yourdomain.com/webhooks/payment
LOG_LEVEL=info
EOF

chmod 600 .env.prod
```

### 3. Docker Compose Prod Stack

Edit `docker-compose.prod.yml` (or create overlay):

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${DATABASE_USER:?}
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:?}
      POSTGRES_DB: orders_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER}']
      interval: 10s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:4-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER:?}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS:?}
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    # NOTE: Admin UI on :15672 NOT published; access via SSH tunnel only

  redis:
    image: redis:8-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: ghcr.io/ndgkhoa/order-management-api:X.Y.Z
    command: node dist/server.js
    environment:
      DATABASE_URL: postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@postgres:5432/orders_db
      RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/
      JWT_SECRET: ${JWT_SECRET:?}
      SMTP_HOST: ${SMTP_HOST:?}
      SMTP_PORT: ${SMTP_PORT:?}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      MAIL_FROM: ${MAIL_FROM:?}
      PAYMENT_WEBHOOK_URL: ${PAYMENT_WEBHOOK_URL:?}
      REDIS_URL: redis://redis:6379
    ports:
      - '3000:3000'
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

  worker:
    image: ghcr.io/ndgkhoa/order-management-api:X.Y.Z
    command: node dist/workers/worker.js
    environment:
      DATABASE_URL: postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@postgres:5432/orders_db
      RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/
      JWT_SECRET: ${JWT_SECRET:?}
      SMTP_HOST: ${SMTP_HOST:?}
      SMTP_PORT: ${SMTP_PORT:?}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      MAIL_FROM: ${MAIL_FROM:?}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

  caddy:
    image: caddy:latest
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    environment:
      DOMAIN: yourdomain.com
    restart: unless-stopped

volumes:
  pgdata:
  rabbitmq_data:
  redis_data:
  caddy_data:
  caddy_config:
```

### 4. Reverse Proxy (Caddy)

Create `Caddyfile`:

```caddyfile
yourdomain.com {
    reverse_proxy api:3000
    encode gzip
}

admin.yourdomain.com {
    # SSH tunnel: ssh -L 15672:rabbitmq:15672 user@host
    # Then visit http://localhost:15672 locally
    respond "Access via SSH tunnel only" 403
}

grafana.yourdomain.com {
    # Optional: expose Grafana for dashboards
    # require_sso
    reverse_proxy prometheus:9090
}
```

(Or use **Traefik** if you prefer; Caddy is simpler for single-host setups.)

### 5. Deploy & Migrate

```bash
export C="docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml"

# Pull latest image
$C pull

# Run migration (must succeed before app starts)
$C run --rm api node dist/infra/db/migrate.js
# Check exit code: echo $?

# Start all services
$C up -d

# Check logs
$C logs -f

# Health check
curl https://yourdomain.com/ready
```

### 6. Backups & Maintenance

**Backup Postgres:**

```bash
# One-off backup
docker exec $(docker ps -q -f "name=postgres") \
  pg_dump -U orders_user orders_db > backup-$(date +%s).sql

# Or on a cron (daily):
# 0 2 * * * cd /app && docker compose exec -T postgres pg_dump -U orders_user orders_db > /backups/db-$(date +\%s).sql
```

**Update image:**

```bash
$C pull
$C run --rm api node dist/infra/db/migrate.js
$C up -d
```

---

## Tier C: Kubernetes + Helm (Stretch Goal)

For multi-node, high-availability setup. Sketch (not fully deployed in this repo):

### Architecture Outline

```yaml
# Two Deployments from same image, different commands
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
spec:
  replicas: 2 # Scale horizontally
  selector:
    matchLabels:
      app: order-api
  template:
    metadata:
      labels:
        app: order-api
    spec:
      containers:
        - name: api
          image: ghcr.io/ndgkhoa/order-management-api:X.Y.Z
          command: ['node', 'dist/server.js']
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: order-secrets
                  key: database-url
            - name: RABBITMQ_URL
              valueFrom:
                secretKeyRef:
                  name: order-secrets
                  key: rabbitmq-url
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '512Mi'
              cpu: '500m'

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-worker
  template:
    metadata:
      labels:
        app: order-worker
    spec:
      containers:
        - name: worker
          image: ghcr.io/ndgkhoa/order-management-api:X.Y.Z
          command: ['node', 'dist/workers/worker.js']
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: order-secrets
                  key: database-url
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'

---
# Service (LoadBalancer or ClusterIP + Ingress)
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 3000
  selector:
    app: order-api

---
# Ingress (TLS via cert-manager)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-api
  annotations:
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - yourdomain.com
      secretName: order-api-tls
  rules:
    - host: yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: order-api
                port:
                  number: 80

---
# Pre-install Job (migration gate)
apiVersion: batch/v1
kind: Job
metadata:
  name: order-db-migrate
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: ghcr.io/ndgkhoa/order-management-api:X.Y.Z
          command: ['node', 'dist/infra/db/migrate.js']
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: order-secrets
                  key: database-url
      restartPolicy: Never
  backoffLimit: 3
```

### Key Points

- **Managed database:** Use RDS, Cloud SQL, or Neon (don't run Postgres in K8s unless you know what you're doing)
- **Managed broker:** CloudAMQP or cloud provider's managed service
- **Secrets:** Use `kubectl create secret` or external-secrets operator
- **HPA:** Add `HorizontalPodAutoscaler` for API based on CPU or custom metrics
- **Migration gate:** Pre-install Job or initContainer runs migration before Deployment rolls out
- **Probes:** Liveness on `/health`, Readiness on `/ready`

For a full Helm chart, see the [Helm repository](https://helm.sh/) docs or a template in `infra/helm/` (not included in this repo).

---

## Deploy Checklist (All Tiers)

- [ ] Secrets in platform store (not in git)
- [ ] `JWT_SECRET` ≥ 32 chars, unique per environment
- [ ] `PAYMENT_WEBHOOK_URL` matches your domain
- [ ] Migration gate runs and exits 0: `node dist/infra/db/migrate.js`
- [ ] API reachable only via TLS reverse proxy (HTTP → HTTPS redirect)
- [ ] Postgres/RabbitMQ ports NOT publicly exposed
- [ ] Both API and worker running from same pinned image tag (`:X.Y.Z`, not `:latest`)
- [ ] `/health` and `/ready` endpoints respond 200
- [ ] Metrics/traces flowing (if collectors configured)
- [ ] Database backups scheduled + tested (restore verification)
- [ ] Logging centralized (e.g., Datadog, Splunk, or ELK)
- [ ] Monitoring alerts configured (error rate, latency, stuck orders)
- [ ] Runbook documented (restart procedures, emergency database steps)

---

## Troubleshooting

### Migration fails: "relation "..." does not exist"

**Cause:** Migration didn't run, or failed silently.

**Fix:**

```bash
# Manually run migration
node dist/infra/db/migrate.js
echo $?  # Should be 0 (success)

# Check drizzle/ directory exists and has SQL files
ls -la drizzle/
```

### API unhealthy: `GET /ready` returns 500

**Check:**

```bash
curl http://localhost:3000/ready -v
# Should return 200 with { status: "ready" }
```

**Debug:**

- Database connectivity: `psql $DATABASE_URL -c "SELECT 1"`
- RabbitMQ connectivity: Check logs for connection errors
- Redis connectivity: Verify REDIS_URL env var

### Worker not consuming events

**Check logs:**

```bash
docker logs <worker-container-id>
# Look for: "consumer listening on queue: ..."
```

**Verify:**

- RabbitMQ broker is healthy
- Exchange + queues exist: `curl http://localhost:15672/api/exchanges`
- Consumer channel is open: Check in RabbitMQ admin UI

### Payment webhook not received

**Check:**

1. Webhook URL is reachable: `curl https://yourdomain.com/webhooks/payment -X POST`
2. Provider has correct endpoint: Check in provider dashboard (Stripe test vs live)
3. Firewall allows incoming traffic on 443
4. TLS certificate is valid: `openssl s_client -connect yourdomain.com:443`

---

## Monitoring & Observability

### Health Endpoints

- `GET /health` — **Liveness** (should respond 200 always, fast)
- `GET /ready` — **Readiness** (DB + RabbitMQ checks; slow path)
- `GET /metrics` — **Prometheus metrics** (request counts, latencies, saga counters)

### Logs

All processes write structured JSON to stdout. Collect with your centralized logging platform:

```bash
# Local development
docker logs <container-id> | jq '.'

# Production (centralized)
# Configure Fluentd, Logstash, or cloud provider's log collector to tail stdout
```

### Traces

If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, OpenTelemetry sends traces to your collector. View in Jaeger or your observability platform.

### Metrics

Prometheus scrapes `/metrics` every 30s. Key saga metrics:

- `saga_orders_created_total` — orders created
- `saga_orders_paid_total` — orders transitioned to paid
- `saga_orders_delivered_total` — orders delivered
- `saga_orders_cancelled_total` — orders cancelled
- `saga_compensation_triggered_total` — compensation events

---

## Rollback Strategy

### Image Rollback

```bash
# If deploying via Git/CD, revert commit:
git revert HEAD

# Or, manually restart with previous tag:
fly deploy --image ghcr.io/ndgkhoa/order-management-api:X.Y.0  # Previous version

# Or, with docker compose:
docker compose pull
docker compose down
docker compose up -d  # Picks up previous tag if pinned in .env
```

### Database Rollback

**If migration fails:**

1. Fix the migration SQL file in `drizzle/`
2. Re-run: `node dist/infra/db/migrate.js`

**If you need to roll back schema:**

- Drizzle down-migrations are manual (not auto-generated)
- Create a `.down.sql` file in `drizzle/` with rollback SQL
- Run: `drizzle-kit migrate --direction=down` (dev-only, not recommended in production)

**Safest approach:** Always test migrations on a staging replica before production.

---

## Support & Documentation

- **GitHub Issues:** Report bugs, request features
- **Architecture:** See [docs/system-architecture.md](./system-architecture.md)
- **Code Standards:** See [docs/code-standards.md](./code-standards.md)
- **Local Dev:** See [README.md](../README.md)
