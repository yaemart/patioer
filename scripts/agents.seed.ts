import { eq } from 'drizzle-orm'
import { schema, withTenantDb } from '@patioer/db'
import { PaperclipBridge } from '@patioer/agent-runtime'

export interface SeedAgentsInput {
  tenantId: string
  appBaseUrl?: string
}

const DEFAULT_CRON: Record<string, string> = {
  'product-scout': '0 6 * * *',
  'price-sentinel': '0 * * * *',
  'support-relay': '*/30 * * * *',
}

export function defaultAgentSpecs(): Array<{
  name: string
  type: 'product-scout' | 'price-sentinel' | 'support-relay'
  goalContext: string
}> {
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
  ]
}

export async function seedDefaultAgents(input: SeedAgentsInput): Promise<{
  created: string[]
  skipped: string[]
  registered: string[]
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
    db.select({ id: schema.agents.id, type: schema.agents.type, name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.tenantId, input.tenantId)),
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
    const callbackUrl = appBaseUrl
      ? `${appBaseUrl}/api/v1/agents/${row.id}/execute`
      : ''

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

async function main(): Promise<void> {
  const tenantId = process.argv[2] ?? ''
  const result = await seedDefaultAgents({ tenantId })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
