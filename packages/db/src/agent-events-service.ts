import type { AppDb } from './client.js'
import { agentEvents } from './schema/agent-events.js'

export interface AppendAgentEventParams {
  tenantId: string
  agentId: string
  action: string
  payload?: unknown
}

/**
 * Appends an immutable audit record to agent_events.
 * Always call this via withTenantDb so the RLS context is set.
 */
export const appendAgentEvent = async (
  db: AppDb,
  params: AppendAgentEventParams,
): Promise<void> => {
  await db.insert(agentEvents).values({
    tenantId: params.tenantId,
    agentId: params.agentId,
    action: params.action,
    payload: params.payload ?? null,
  })
}
