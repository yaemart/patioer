import { listTenantIds, withTenantDb, schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import { PaperclipBridge } from '@patioer/agent-runtime'

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

  const activeAgents: Array<{ id: string; tenantId: string; type: string; name: string }> = []

  for (const tenantId of tenantIds) {
    const agents = await withTenantDb(tenantId, (tdb) =>
      tdb
        .select({
          id: schema.agents.id,
          tenantId: schema.agents.tenantId,
          type: schema.agents.type,
          name: schema.agents.name,
        })
        .from(schema.agents)
        .where(eq(schema.agents.status, 'active')),
    )
    activeAgents.push(...agents)
  }

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
