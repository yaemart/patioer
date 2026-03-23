import type { FastifyBaseLogger } from 'fastify'
import type { AppDb } from '@patioer/db'
import { schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import { getOrCreateHarnessFromCredential } from './harness-from-credential.js'
import { resolveFirstCredentialFromDb } from './resolve-credential.js'
export interface AgentExecuteProbeResult {
  ok: boolean
  agentId: string
  agentType: string
  platform: string
  error?: string
  probe: string
}

/**
 * Exercises the agent-execute pipeline (DB agent lookup → credential resolve → harness init)
 * without running the agent or writing side-effects.  Used by the onboarding health check
 * and the `?probe=1` query on the execute route.
 */
export async function probeAgentExecution(params: {
  tenantId: string
  withDb: <T>(cb: (db: AppDb) => Promise<T>) => Promise<T>
  log: FastifyBaseLogger
}): Promise<AgentExecuteProbeResult> {
  const agentRows = await params.withDb((db) =>
    db
      .select({ id: schema.agents.id, type: schema.agents.type, name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.tenantId, params.tenantId)),
  )

  const canary = agentRows[0]

  if (!canary) {
    return { ok: false, agentId: '', agentType: '', platform: '', error: 'no_agent_rows', probe: 'agent_execute' }
  }

  const resolved = await params.withDb((db) => resolveFirstCredentialFromDb(db, params.tenantId))
  if (!resolved) {
    return {
      ok: false,
      agentId: canary.id,
      agentType: canary.type,
      platform: '',
      error: 'no_credentials',
      probe: 'agent_execute',
    }
  }

  const { cred, platform } = resolved

  try {
    getOrCreateHarnessFromCredential(params.tenantId, platform, {
      accessToken: cred.accessToken,
      shopDomain: cred.shopDomain,
      region: cred.region,
      metadata: cred.metadata,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    params.log.warn({ err, platform }, 'agent_execute_probe.harness_init_failed')
    return {
      ok: false,
      agentId: canary.id,
      agentType: canary.type,
      platform,
      error: `harness_init: ${message}`,
      probe: 'agent_execute',
    }
  }

  return { ok: true, agentId: canary.id, agentType: canary.type, platform, probe: 'agent_execute' }
}
