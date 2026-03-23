# Harness paths & Market context

## Two ways to obtain a `TenantHarness`

| Path | When to use | Credential source |
|------|-------------|-------------------|
| **`createHarness` + `HarnessRegistry` (class)** in `apps/api/src/lib/harness-registry.ts` | **HTTP agent execution** (`POST /api/v1/agents/:id/execute`), approval worker, any route that resolves `platform_credentials` per tenant | Database (`platform_credentials`) + `CRED_ENCRYPTION_KEY` |
| **`registerHarnessFactory` + `getHarness(tenantId, platform)`** (module API in `@patioer/harness`) | Internal jobs, scripts, or future MCP tools that should use **process env** (e.g. `AMAZON_*`) without DB | `registerPlatformHarnessFactories()` in `apps/api/src/lib/agent-bootstrap.ts`, called from `server.ts` after `dotenv.config()` |

Do not assume registering env-based factories affects the execute route — that path always uses DB-backed credentials when present.

### Module-level `getHarness` cache & credential rotation

`getHarness(tenantId, platform)` keeps **one harness instance per `(tenantId, platform)` for the lifetime of the process**. Factories registered via `registerHarnessFactory` usually read `process.env` when the harness is first constructed.

- After **rotating env-based secrets** (e.g. `AMAZON_*`), either **restart the process** (rolling deploy) **or** call `invalidateHarnessInstance(tenantId, platform)` from `@patioer/harness` so the next `getHarness` rebuilds with new env values.
- `clearHarnessInstances()` drops **all** cached module-level instances (tests and rare admin scenarios); prefer targeted `invalidateHarnessInstance` in production.

The **API `HarnessRegistry` class** (`apps/api/src/lib/harness-registry.ts`) is separate: TTL-based cache + `invalidate` on auth failures — that path does not use the module-level map above.

### `getAnalytics` and `truncated`

All harnesses return `Analytics` with optional `truncated`. When **`truncated === true`**, the harness **did not aggregate every order in the range** (single-page / cap hit): **`revenue` and `orders` are lower bounds**, not guaranteed full-period totals. For finance-grade numbers, use platform reporting APIs or extend harnesses to paginate. See JSDoc on `Analytics` in `packages/harness/src/types.ts`.

### HTTP client resilience (reference)

Per-request `fetch` timeout is **15s** across Shopify / Amazon / TikTok / Shopee harnesses. Retry counts differ by platform (intentional until a future unification sprint):

| Platform | Max retries (typical) | Notes |
|----------|------------------------|--------|
| Amazon SP-API | 5 | 429 / 5xx with backoff |
| Shopify, TikTok, Shopee | 3 | Retry policy differs slightly (e.g. Shopify honors `Retry-After`) |

## Multi-platform webhooks (Amazon / TikTok / Shopee)

HTTP routes verify signatures and persist events. **`dispatchWebhook`** in `apps/api/src/lib/webhook-topic-handler.ts` routes by topic string.

- **Production:** `server.ts` calls `registerStubPlatformWebhookHandlers()` so every known non-Shopify topic has a **no-op handler** — avoids `webhookDispatchNoHandlerTotal` / `console.warn` noise until per-topic business logic exists. Shopify order/product handling stays on `handleWebhookTopic` (replay path).
- **Tests:** use `_clearWebhookHandlers()`; stubs are not registered unless you call `registerStubPlatformWebhookHandlers()` in the test.

## `MarketContext` (`@patioer/market`)

- **Agent runtime:** `createAgentContext` accepts optional `deps.market`. The API wires this in `agents-execute.ts` using `createMarketContext({ redis: getRedisClient() })` so agents can call `ctx.getMarket()?.convertPrice` / `calculateTax` / `checkCompliance` with Redis-cached FX rates.
- **Tax / compliance rules** remain code-first (Phase 2); moving policy to data or prompts is a later agent-native iteration.
