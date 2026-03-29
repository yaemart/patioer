import { eq } from 'drizzle-orm'
import { withTenantDb, schema } from '@patioer/db'

export interface AuditEventInput {
  tenantId: string
  eventType: string
  payload: Record<string, unknown>
}

export interface AuditEventRecorder {
  record(event: AuditEventInput): Promise<void>
}

export function createBestEffortAuditEventRecorder(): AuditEventRecorder {
  return {
    async record(event) {
      await withTenantDb(event.tenantId, async (tdb) => {
        const [agent] = await tdb
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(eq(schema.agents.tenantId, event.tenantId))
          .limit(1)

        // Some tenant-level business flows can happen before any agent exists.
        // Keep the primary action successful and persist audit events once an agent row is available.
        if (!agent) {
          return
        }

        await tdb.insert(schema.agentEvents).values({
          tenantId: event.tenantId,
          agentId: agent.id,
          action: event.eventType,
          payload: event.payload,
        })
      })
    },
  }
}
