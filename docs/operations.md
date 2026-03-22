# ElectroOS Operations Guide

## 1. Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- Docker & Docker Compose (for PostgreSQL)

### Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yaemart/patioer.git
cd patioer
pnpm install

# 2. Start PostgreSQL
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set SHOPIFY_ENCRYPTION_KEY (generate: openssl rand -hex 32)

# 4. Run migrations
pnpm --filter db migrate

# 5. (Optional) Seed demo agents
pnpm --filter scripts seed:agents

# 6. Start the API server
pnpm --filter api dev
# API available at http://localhost:3100
# Swagger UI at http://localhost:3100/api/v1/docs
```

### Running Tests

```bash
# All tests (monorepo)
pnpm test

# API tests only
pnpm --filter api test

# With coverage (enforces thresholds)
pnpm --filter api test:coverage

# Specific test file
pnpm --filter api test -- src/routes/agents.test.ts
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all packages in dev mode |
| `pnpm --filter api dev` | Start API server with hot reload |
| `pnpm --filter api build` | Compile TypeScript |
| `pnpm --filter api lint` | Run ESLint |
| `pnpm --filter api typecheck` | Type-check without emitting |
| `pnpm --filter api test:coverage` | Run tests with coverage thresholds |

---

## 2. Environment Variables

All variables are documented in `.env.example`. Copy it to `.env` for local development.

### Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3100` | API server port |

### Paperclip Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PAPERCLIP_API_URL` | Yes | — | Paperclip service base URL |
| `PAPERCLIP_API_KEY` | Yes | — | API key for Paperclip auth (shared between API & agent-execute route) |
| `PAPERCLIP_TIMEOUT_MS` | No | `5000` | HTTP timeout for Paperclip requests |
| `PAPERCLIP_MAX_RETRIES` | No | `2` | Max retry attempts on Paperclip failures |
| `PAPERCLIP_RETRY_BASE_MS` | No | `200` | Base delay for exponential backoff |

### Budget Gate

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_BUDGET_FORCE_EXCEEDED` | No | `0` | Set to `1` to force all budget checks to return exceeded (testing) |
| `AGENT_BUDGET_FAIL_OPEN` | No | `0` | Set to `1` to allow execution when budget provider is unavailable |

### Tenant Discovery

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TENANT_DISCOVERY_API_KEY` | Yes | — | API key for tenant resolution endpoint |
| `TENANT_DISCOVERY_RATE_LIMIT_MAX` | No | `60` | Max requests per window |
| `TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |

### Shopify

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHOPIFY_CLIENT_ID` | Yes | — | Shopify app client ID (Partners Dashboard) |
| `SHOPIFY_CLIENT_SECRET` | Yes | — | Shopify app client secret |
| `SHOPIFY_ENCRYPTION_KEY` | Yes | — | 32-byte hex key for token encryption (`openssl rand -hex 32`) |
| `SHOPIFY_WEBHOOK_SECRET` | Yes | — | Webhook HMAC signing secret |
| `APP_BASE_URL` | Yes | — | Public URL for OAuth callback redirect (shared with Amazon OAuth) |

### Amazon SP-API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AMAZON_CLIENT_ID` | Yes | — | SP-API app client ID (Seller Central → Developer Console) |
| `AMAZON_CLIENT_SECRET` | Yes | — | SP-API app client secret |
| `CRED_ENCRYPTION_KEY` | Yes | — | 32-byte hex key for Amazon refresh_token encryption (`openssl rand -hex 32`) |

**Amazon LWA OAuth Flow:**

1. Initiate: `GET /api/v1/amazon/auth?tenantId=<id>&sellerId=<id>&marketplaceId=<id>&region=na`
2. Merchant authorizes on Amazon Seller Central
3. Amazon redirects to `GET /api/v1/amazon/auth/callback?code=...&state=...`
4. Encrypted `refresh_token` is persisted in `platform_credentials` (`platform=amazon`, `credential_type=lwa`)

### TikTok Shop

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TIKTOK_APP_KEY` | Yes (OAuth / auth URL) | — | App Key from Partner Center (also passed as query `appKey` where applicable) |
| `TIKTOK_APP_SECRET` | Yes | — | App Secret — used for API request signing, webhook HMAC, and OAuth-related crypto |
| `TIKTOK_STATE_SECRET` | Optional | — | Separate key for signing OAuth `state` (recommended; generate with `openssl rand -hex 32`) |

**Credential flow:**

1. Create a TikTok Shop app in [Partner Center](https://partner.tiktokshop.com/) and obtain **App Key** + **App Secret**.
2. Activate a **sandbox** shop for development; production uses separate app review.
3. Set `TIKTOK_APP_KEY` / `TIKTOK_APP_SECRET` in `.env` (API process). Webhook verification uses `TIKTOK_APP_SECRET` only — see `POST /api/v1/webhooks/tiktok` (headers: `Authorization` Base64 HMAC, `x-timestamp`, `x-nonce`, `x-tenant-id`).

**OAuth:**

- `GET /api/v1/tiktok/auth?tenantId=<id>&appKey=<key>` — redirects to TikTok authorization; `state` binds the tenant.

### Shopee Open Platform

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHOPEE_PARTNER_ID` | Yes | — | Partner ID from Shopee Open Platform console |
| `SHOPEE_PARTNER_KEY` | Yes | — | Partner Key — used for API signatures and webhook verification |

**Credential flow:**

1. Register as a developer in [Shopee Open Platform](https://open.shopee.com/) and create an app to get **Partner ID** and **Partner Key**.
2. **Multi-market:** each seller authorizes per market (e.g. SG, MY). OAuth routes accept `market=SG` etc.; stored credentials are scoped per shop + market in metadata.
3. Set `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` in `.env` for the API and webhook signing.

**OAuth:**

- `GET /api/v1/shopee/auth?tenantId=<id>&market=SG` — builds signed redirect URL (partner_id + sign).

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Yes (Phase 2) | `redis://localhost:6379` | BullMQ job queues + platform API rate-limiter |

Start Redis locally:

```bash
docker compose up -d redis

# Verify
docker exec patioer-redis redis-cli PING   # expected: PONG
```

---

## 3. Deployment (Docker Compose)

### Full Stack

```bash
docker compose up -d
```

This starts:
- **postgres** — PostgreSQL 14 on port 5432
- **paperclip** — Paperclip service on port 3000
- **api** — ElectroOS API on port 3100

### Production Considerations

1. **Database**: Use a managed PostgreSQL (RDS, Cloud SQL) instead of the Docker container
2. **Secrets**: Store sensitive env vars in a secrets manager, not in `.env` files
3. **HTTPS**: Place a reverse proxy (nginx, Caddy) or load balancer in front of the API
4. **Migrations**: Run `pnpm --filter db migrate` as part of the deployment pipeline, before starting the API
5. **Health check**: Use `GET /api/v1/health` for liveness/readiness probes

### Docker Compose Environment Override

For production-like local testing, create `docker-compose.override.yml`:

```yaml
services:
  api:
    environment:
      SHOPIFY_ENCRYPTION_KEY: "${SHOPIFY_ENCRYPTION_KEY}"
      SHOPIFY_CLIENT_ID: "${SHOPIFY_CLIENT_ID}"
      SHOPIFY_CLIENT_SECRET: "${SHOPIFY_CLIENT_SECRET}"
      SHOPIFY_WEBHOOK_SECRET: "${SHOPIFY_WEBHOOK_SECRET}"
      APP_BASE_URL: "${APP_BASE_URL}"
      PAPERCLIP_API_KEY: "${PAPERCLIP_API_KEY}"
      TENANT_DISCOVERY_API_KEY: "${TENANT_DISCOVERY_API_KEY}"
```

---

## 4. API Documentation

Interactive API docs are available at:

```
http://localhost:3100/api/v1/docs
```

The OpenAPI 3.0 JSON spec is available at:

```
http://localhost:3100/api/v1/docs/json
```

### Route Groups

| Tag | Endpoints | Auth |
|-----|-----------|------|
| System | `GET /api/v1/health` | None |
| Agents | `GET/POST/PATCH/DELETE /api/v1/agents` | `x-tenant-id` |
| Agent Execution | `POST /api/v1/agents/:id/execute` | `x-api-key` + `x-tenant-id` |
| Approvals | `GET/PATCH /api/v1/approvals` | `x-tenant-id` |
| Products | `POST /api/v1/products/sync` | `x-tenant-id` |
| Orders | `POST /api/v1/orders` | `x-tenant-id` |
| Shopify OAuth | `GET /api/v1/shopify/auth`, `GET /api/v1/shopify/callback` | None (OAuth flow) |
| Shopify Webhooks | `POST /api/v1/webhooks/shopify` | HMAC signature |
| Amazon OAuth | `GET /api/v1/amazon/auth`, `GET /api/v1/amazon/auth/callback` | None (OAuth flow) |
| Amazon Webhooks | `POST /api/v1/webhooks/amazon` | `x-tenant-id` header |
| TikTok OAuth | `GET /api/v1/tiktok/auth` | None (OAuth flow) |
| TikTok Webhooks | `POST /api/v1/webhooks/tiktok` | `Authorization` HMAC + `x-timestamp` + `x-nonce` + `x-tenant-id` |
| Shopee OAuth | `GET /api/v1/shopee/auth`, `GET /api/v1/shopee/auth/callback` | None (OAuth flow) |
| Shopee Webhooks | `POST /api/v1/webhooks/shopee` | Partner signature + `x-tenant-id` |
| Tenant Discovery | `GET /api/v1/tenants/resolve` | `x-api-key` |

---

## 5. Multi-Tenancy & RLS

All business tables enforce PostgreSQL Row-Level Security:

- Every request sets `app.tenant_id` via `withTenantDb` before any query
- `FORCE ROW LEVEL SECURITY` ensures even table owners cannot bypass policies
- The `tenant` plugin (`src/plugins/tenant.ts`) extracts `x-tenant-id` from headers and attaches `request.withDb` / `request.tenantId`

**Never use the raw `db` connection for business data queries.** Always use `request.withDb()`.

---

## 6. Coverage Thresholds

Configured in `apps/api/vitest.config.ts` and enforced in CI:

| Metric | Threshold | Current |
|--------|-----------|---------|
| Statements | ≥ 80% | 93.05% |
| Branches | ≥ 70% | 88.32% |
| Functions | ≥ 65% | 79.38% |
| Lines | ≥ 80% | 94.12% |

---

## 7. Staging Environment

Staging uses a separate Docker Compose file (`docker-compose.staging.yml`) with its own database, health checks, and automatic migration/seed pipeline.

### Quick Start

```bash
# 1. Prepare staging env file
cp .env.staging .env.staging.local
# Edit .env.staging.local with real Shopify credentials

# 2. One-click start
./scripts/staging-up.sh
```

This will:
1. Start PostgreSQL (port 5433 by default, separate from dev)
2. Wait for PG to be healthy
3. Run `drizzle-kit push` to apply schema (including RLS)
4. Run `agents.seed.ts` to create demo tenants and agents
5. Start Paperclip service
6. Start ElectroOS API (port 3100)
7. Wait for API health check to pass

### Commands

| Command | Description |
|---------|-------------|
| `./scripts/staging-up.sh` | Start all services |
| `./scripts/staging-up.sh down` | Stop all services |
| `./scripts/staging-up.sh reset` | Destroy volumes and restart fresh |
| `./scripts/staging-up.sh logs` | Tail API logs |
| `./scripts/staging-up.sh health` | Check API health |
| `./scripts/staging-up.sh psql` | Open psql to staging database |

### Port Mapping

| Service | Default Port | Override Env Var |
|---------|-------------|-----------------|
| PostgreSQL | 5433 | `POSTGRES_PORT` |
| API | 3100 | `API_PORT` |
| Paperclip | 3000 | `PAPERCLIP_PORT` |

### 72-Hour Stability Run (Task 4.3)

After staging is up:

```bash
# 1. Start staging
./scripts/staging-up.sh

# 2. Verify all 3 agents are bootstrapped
./scripts/staging-up.sh logs | grep "agent bootstrap"

# 3. Monitor for 72 hours — check periodically:
./scripts/staging-up.sh health
docker compose -f docker-compose.staging.yml ps

# 4. After 72h, verify:
#    - API container has not restarted (check restart count)
docker inspect patioer-staging-api --format='{{.RestartCount}}'
#    - Agent heartbeats are still firing (check Paperclip)
#    - No error-level logs in last 72h
./scripts/staging-up.sh logs 2>&1 | grep -c '"level":50'
#    - Webhook replay ran at startup without errors
./scripts/staging-up.sh logs 2>&1 | grep "webhook replay"
```

### AC-01 Verification (Paperclip Integration)

Once Paperclip is running in staging:

```bash
# 1. Check bootstrap result
./scripts/staging-up.sh logs 2>&1 | grep "agent bootstrap complete"
# Expected: {"total":3,"registered":3,"skipped":0,"errors":[]}

# 2. Verify in Paperclip Dashboard
# Open http://localhost:3000 (or your Paperclip URL)
# Confirm: price-sentinel, product-scout, support-relay all show ACTIVE

# 3. Test agent execution
curl -X POST http://localhost:3100/api/v1/agents/<AGENT_ID>/execute \
  -H "x-api-key: staging-paperclip-key" \
  -H "x-tenant-id: <TENANT_ID>"
```

### AC-05/06/07 Integration Test (RLS with Real DB)

```bash
# 1. Open psql
./scripts/staging-up.sh psql

# 2. Verify RLS is active (should return 0 rows without tenant context)
SELECT * FROM products;
SELECT * FROM agents;
SELECT * FROM orders;

# 3. Test cross-tenant isolation via API
# Create data as Tenant A
curl -X POST http://localhost:3100/api/v1/agents \
  -H "x-tenant-id: <TENANT_A_ID>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Agent","type":"price-sentinel"}'

# Try to read as Tenant B (should not see Tenant A's agent)
curl http://localhost:3100/api/v1/agents \
  -H "x-tenant-id: <TENANT_B_ID>"
# Expected: {"agents":[]}  (empty — RLS blocks cross-tenant access)
```

### Teardown

```bash
# Stop without deleting data
./scripts/staging-up.sh down

# Full reset (destroys DB volumes)
./scripts/staging-up.sh reset
```
