import { PaperclipBridge } from '@patioer/agent-runtime'
import { schema, withTenantDb } from '@patioer/db'

export interface SeedAgentsInput {
  tenantId: string
  appBaseUrl?: string
  /**
   * When true: reads existing agent `type` rows only; reports what would be created vs skipped;
   * performs no inserts and no Paperclip calls (no side effects, no budget/heartbeat side effects).
   */
  dryRun?: boolean
}

/** Heartbeat crons aligned with agent-runtime defaults (ads 4h, inventory daily 08:00 local via Paperclip/CRON_TZ). */
const DEFAULT_CRON: Record<string, string> = {
  'product-scout': '0 6 * * *',
  'price-sentinel': '0 * * * *',
  'support-relay': '*/30 * * * *',
  'ads-optimizer': '0 */4 * * *',
  'inventory-guard': '0 8 * * *',
}

export type DefaultAgentSpec = {
  name: string
  type: 'product-scout' | 'price-sentinel' | 'support-relay' | 'ads-optimizer' | 'inventory-guard'
  goalContext: string
}

/**
 * Five default agents (Sprint 4 · same set as `scripts/agents.seed.ts` / Task 4.9).
 * Shared by CLI seed and `POST /api/v1/onboarding/initialize-agents` (Day 9).
 */
export function defaultAgentSpecs(): DefaultAgentSpec[] {
  return [
    {
      name: 'Product Scout',
      type: 'product-scout',
      goalContext: '{"mode":"daily-scan","runAt":"06:00"}',
    },
    {
      name: 'Price Sentinel',
      type: 'price-sentinel',
      goalContext: '{"approvalThresholdPercent":15,"proposals":[]}',
    },
    {
      name: 'Support Relay',
      type: 'support-relay',
      goalContext: '{"policy":"auto_reply_non_refund"}',
    },
    {
      name: 'Ads Optimizer',
      type: 'ads-optimizer',
      goalContext: '{"targetRoas":3}',
    },
    {
      name: 'Inventory Guard',
      type: 'inventory-guard',
      goalContext: '{}',
    },
  ]
}

export async function seedDefaultAgents(input: SeedAgentsInput): Promise<{
  created: string[]
  skipped: string[]
  registered: string[]
  dryRun?: true
}> {
  if (!input.tenantId) throw new Error('tenantId is required')

  const dbResult = await withTenantDb(input.tenantId, async (db) => {
    const existingRows = await db.select({ type: schema.agents.type }).from(schema.agents)
    const existing = new Set(existingRows.map((row) => row.type))
    const created: string[] = []
    const skipped: string[] = []

    for (const spec of defaultAgentSpecs()) {
      if (existing.has(spec.type)) {
        skipped.push(spec.type)
        continue
      }
      if (input.dryRun) {
        created.push(spec.type)
        continue
      }
      await db.insert(schema.agents).values({
        tenantId: input.tenantId,
        name: spec.name,
        type: spec.type,
        status: 'active',
        goalContext: spec.goalContext,
      })
      created.push(spec.type)
    }

    return { created, skipped }
  })

  if (input.dryRun) {
    return { ...dbResult, registered: [], dryRun: true }
  }

  const registered = await registerWithPaperclip(input)

  return { ...dbResult, registered }
}

async function registerWithPaperclip(input: SeedAgentsInput): Promise<string[]> {
  const baseUrl = process.env.PAPERCLIP_API_URL
  const apiKey = process.env.PAPERCLIP_API_KEY
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL
  if (!baseUrl || !apiKey) return []

  const bridge = new PaperclipBridge({ baseUrl, apiKey })
  const company = await bridge.ensureCompany({
    tenantId: input.tenantId,
    name: `tenant-${input.tenantId}`,
  })
  const project = await bridge.ensureProject({
    companyId: company.id,
    name: 'patioer',
  })

  const agentRows = await withTenantDb(input.tenantId, (db) =>
    db
      .select({ id: schema.agents.id, type: schema.agents.type, name: schema.agents.name })
      .from(schema.agents),
  )

  const registered: string[] = []

  for (const row of agentRows) {
    const agent = await bridge.ensureAgent({
      companyId: company.id,
      projectId: project.id,
      name: row.name,
      externalAgentId: row.id,
    })

    const cron = DEFAULT_CRON[row.type] ?? '0 */6 * * *'
    const callbackUrl = appBaseUrl ? `${appBaseUrl}/api/v1/agents/${row.id}/execute` : ''

    if (callbackUrl) {
      await bridge.registerHeartbeat({
        companyId: company.id,
        agentId: agent.id,
        cron,
        callbackUrl,
      })
      registered.push(row.type)
    }
  }

  return registered
}
