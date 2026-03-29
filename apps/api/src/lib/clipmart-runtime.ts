import { and, eq } from 'drizzle-orm'
import { schema, withTenantDb } from '@patioer/db'
import type { AgentConfig, AgentManager, EventRecorder } from '@patioer/clipmart'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'
import { createBestEffortAuditEventRecorder } from './audit-event-recorder.js'

const VALID_AGENT_TYPES = new Set(ELECTROOS_AGENT_IDS)

export function createDbClipmartAgentManager(): AgentManager {
  return {
    async upsertAgent(tenantId: string, agent: AgentConfig) {
      if (!VALID_AGENT_TYPES.has(agent.type as (typeof ELECTROOS_AGENT_IDS)[number])) {
        throw new Error(`Unsupported agent type: ${agent.type}`)
      }

      await withTenantDb(tenantId, async (tdb) => {
        const [existing] = await tdb
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.type, agent.type as never)))
          .limit(1)

        const status: 'active' | 'suspended' | 'error' =
          agent.status === 'suspended' || agent.status === 'error'
            ? agent.status
            : 'active'
        const patch = {
          name: agent.name,
          status,
          goalContext: agent.goalContext ? JSON.stringify(agent.goalContext) : null,
          systemPrompt: typeof agent.systemPrompt === 'string' ? agent.systemPrompt : null,
          updatedAt: new Date(),
        }

        if (existing) {
          await tdb
            .update(schema.agents)
            .set(patch)
            .where(eq(schema.agents.id, existing.id))
          return
        }

        await tdb.insert(schema.agents).values({
          tenantId,
          name: agent.name,
          type: agent.type as never,
          status,
          goalContext: patch.goalContext,
          systemPrompt: patch.systemPrompt,
        })
      })
    },
  }
}

export function createDbClipmartEventRecorder(): EventRecorder {
  return createBestEffortAuditEventRecorder()
}
