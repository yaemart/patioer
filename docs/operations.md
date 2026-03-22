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
| `APP_BASE_URL` | Yes | — | Public URL for OAuth callback redirect |

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
| Webhooks | `POST /api/v1/webhooks/shopify` | HMAC signature |
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
