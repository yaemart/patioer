import { listTenantIds, withTenantDb, schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import { PaperclipBridge } from '@patioer/agent-runtime'
import { AmazonHarness, registerHarnessFactory } from '@patioer/harness'
import { parseAmazonRegion } from './amazon-region.js'

/**
 * Register platform harness factories at application startup.
 * Each factory reads credentials from environment variables so secrets are
 * never embedded in code.  Call once from `apps/api/src/server.ts` immediately
 * after `dotenv.config()` (before `buildServer()`).
 *
 * **Two harness paths (do not confuse them):**
 *
 * 1. **HTTP agent execution** (`POST /api/v1/agents/:id/execute`) uses
 *    `createHarness()` + `HarnessRegistry` in `harness-registry.ts` with credentials
 *    from `platform_credentials` (per-tenant). That is the primary path for
 *    Paperclip / cron callbacks.
 *
 * 2. **Module-level `getHarness(tenantId, platform)`** from `@patioer/harness`
 *    is populated by *this* function. It is for callers that need a harness
 *    without DB credential resolution (e.g. scripts, future MCP tools, or
 *    internal jobs using `AMAZON_*` env vars).
 *
 * Amazon sandbox/production is controlled by AMAZON_USE_SANDBOX:
 *   - unset / "true"  → sandbox endpoints (safe default for dev/CI)
 *   - "false"         → production SP-API endpoints
 *
 * After rotating `AMAZON_*` env vars without restarting, call
 * `invalidateHarnessInstance(tenantId, 'amazon')` from `@patioer/harness`
 * so `getHarness` rebuilds the harness (see `docs/architecture/harness-and-market.md`).
 */
export function registerPlatformHarnessFactories(): void {
  registerHarnessFactory('amazon', (tenantId) =>
    new AmazonHarness(tenantId, {
      clientId: process.env.AMAZON_CLIENT_ID ?? '',
      clientSecret: process.env.AMAZON_CLIENT_SECRET ?? '',
      refreshToken: process.env.AMAZON_REFRESH_TOKEN ?? '',
      sellerId: process.env.AMAZON_SELLER_ID ?? '',
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID ?? 'ATVPDKIKX0DER',
      region: parseAmazonRegion(process.env.AMAZON_REGION),
      useSandbox: process.env.AMAZON_USE_SANDBOX !== 'false',
    }),
  )
}

export interface BootstrapResult {
  total: number
  registered: number
  skipped: number
  errors: Array<{ agentId: string; error: string }>
}

export const DEFAULT_CRON: Record<string, string> = {
  'product-scout': '0 6 * * *',
  'price-sentinel': '0 * * * *',
  'support-relay': '*/30 * * * *',
}

export async function bootstrapActiveAgents(
  bridge: PaperclipBridge,
  appBaseUrl: string,
): Promise<BootstrapResult> {
  const tenantIds = await listTenantIds()

  // Fetch active agents for all tenants concurrently to avoid N+1 serial round-trips.
  const agentLists = await Promise.all(
    tenantIds.map((tenantId) =>
      withTenantDb(tenantId, (tdb) =>
        tdb
          .select({
            id: schema.agents.id,
            tenantId: schema.agents.tenantId,
            type: schema.agents.type,
            name: schema.agents.name,
          })
          .from(schema.agents)
          .where(eq(schema.agents.status, 'active')),
      ),
    ),
  )
  const activeAgents = agentLists.flat()

  const result: BootstrapResult = {
    total: activeAgents.length,
    registered: 0,
    skipped: 0,
    errors: [],
  }

  if (activeAgents.length === 0) return result

  if (!appBaseUrl) {
    result.skipped = activeAgents.length
    return result
  }

  for (const agent of activeAgents) {
    try {
      const company = await bridge.ensureCompany({
        tenantId: agent.tenantId,
        name: `tenant-${agent.tenantId}`,
      })

      const project = await bridge.ensureProject({
        companyId: company.id,
        name: 'patioer',
      })

      const paperclipAgent = await bridge.ensureAgent({
        companyId: company.id,
        projectId: project.id,
        name: agent.name,
        externalAgentId: agent.id,
      })

      const cron = DEFAULT_CRON[agent.type] ?? '0 */6 * * *'
      const callbackUrl = `${appBaseUrl}/api/v1/agents/${agent.id}/execute`

      await bridge.registerHeartbeat({
        companyId: company.id,
        agentId: paperclipAgent.id,
        cron,
        callbackUrl,
      })

      result.registered += 1
    } catch (err) {
      result.errors.push({
        agentId: agent.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
