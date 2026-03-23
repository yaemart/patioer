import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { HarnessError } from '@patioer/harness'
import { createAgentContext } from '@patioer/agent-runtime'
import { registry } from '../lib/harness-registry.js'
import { getOrCreateHarnessFromCredential } from '../lib/harness-from-credential.js'
import type { SupportedPlatform } from '../lib/harness-factory.js'
import { SUPPORTED_PLATFORMS } from '../lib/supported-platforms.js'
import {
  listEnabledPlatformsFromDb,
  queryCredentialForPlatform,
  resolveFirstCredential,
} from '../lib/resolve-credential.js'
import { createIssueForAgentTicket } from '../lib/agent-paperclip-ticket.js'
import { verifyPaperclipAuth } from '../lib/paperclip-auth.js'
import { createLlmProvider } from '../lib/llm-client.js'
import { getRunner, type ExecuteAgentResponse } from '../lib/agent-registry.js'
import { getExecutionServices } from '../lib/execution-services.js'
import type { BudgetStatus } from '../lib/execution-services.js'

const paramsSchema = z.object({ id: z.string().uuid() })

export type { BudgetStatus }

export function getBudgetStatus(tenantId: string, agentId: string): Promise<BudgetStatus> {
  return getExecutionServices().getBudgetStatus(tenantId, agentId)
}

export async function onBudgetExceeded(
  request: FastifyRequest,
  tenantId: string,
  agentId: string,
  details: { remaining: number },
): Promise<void> {
  if (!request.withDb) return
  await request.withDb(async (db) => {
    await db
      .update(schema.agents)
      .set({ status: 'suspended' })
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, tenantId)))
    await db.insert(schema.agentEvents).values({
      tenantId,
      agentId,
      action: 'agent.execute.blocked.budget_exceeded',
      payload: details,
    })
  })
}

export {
  buildPriceSentinelInput,
  buildProductScoutInput,
  buildSupportRelayInput,
  buildAdsOptimizerInput,
  buildInventoryGuardInput,
} from '../lib/agent-inputs.js'

type AgentContext = ReturnType<typeof createAgentContext>
type ExecutionLoadResult =
  | { ok: true; agentRow: { id: string; type: string; goalContext: string | null; systemPrompt: string | null }; ctx: AgentContext; platform: SupportedPlatform }
  | { ok: false; statusCode: number; body: { error: string } }

async function buildExecutionContext(
  request: FastifyRequest,
  agentId: string,
): Promise<ExecutionLoadResult> {
  if (!request.withDb || !request.tenantId) {
    return { ok: false, statusCode: 401, body: { error: 'x-tenant-id required' } }
  }

  const [agentRow] = await request.withDb((db) =>
    db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, request.tenantId!)))
      .limit(1),
  )

  if (!agentRow) {
    return { ok: false, statusCode: 404, body: { error: 'agent not found' } }
  }

  const resolved = await resolveFirstCredential(request)
  if (!resolved) {
    return { ok: false, statusCode: 404, body: { error: 'No platform credentials found' } }
  }

  const { platform } = resolved
  const registryKey = `${request.tenantId}:${platform}`

  const enabledPlatforms = await request.withDb((db) =>
    listEnabledPlatformsFromDb(db, request.tenantId!),
  )

  const harnessByPlatform = new Map<SupportedPlatform, ReturnType<typeof getOrCreateHarnessFromCredential>>()
  try {
    for (const p of enabledPlatforms) {
      const row = await request.withDb((db) =>
        queryCredentialForPlatform(db, request.tenantId!, p),
      )
      if (!row) continue
      harnessByPlatform.set(
        p,
        getOrCreateHarnessFromCredential(request.tenantId!, p, {
          accessToken: row.accessToken,
          shopDomain: row.shopDomain,
          region: row.region,
          metadata: row.metadata,
        }),
      )
    }
  } catch (err) {
    request.log.warn({ err, registryKey, platform }, 'createHarness failed during agent execution load')
    return {
      ok: false,
      statusCode: 502,
      body: { error: err instanceof Error ? err.message : 'harness initialization failed' },
    }
  }

  const defaultHarness = harnessByPlatform.get(platform)
  if (!defaultHarness) {
    request.log.warn(
      { tenantId: request.tenantId, platform, enabledPlatforms },
      'default harness missing from multi-platform map',
    )
    return { ok: false, statusCode: 502, body: { error: 'harness initialization failed' } }
  }

  request.log.info(
    { tenantId: request.tenantId, agentId: agentRow.id, enabledPlatforms, defaultPlatform: platform },
    'agent.execute.context.ready',
  )

  const ctx = createAgentContext(
    { tenantId: request.tenantId, agentId: agentRow.id },
    {
      harness: buildHarnessDeps(harnessByPlatform, defaultHarness, enabledPlatforms),
      budget: {
        isExceeded: async (tid, aid) => (await getExecutionServices().getBudgetStatus(tid, aid)).exceeded,
      },
      audit: buildAuditDeps(request),
      approvals: buildApprovalDeps(request, platform),
      tickets: buildTicketDeps(request),
      llm: createLlmProvider(agentRow.systemPrompt),
      market: getExecutionServices().getMarketContext(),
      approvalsQuery: buildApprovalsQueryDeps(request),
      events: buildEventsDeps(request),
    },
  )

  return {
    ok: true,
    agentRow: { id: agentRow.id, type: agentRow.type, goalContext: agentRow.goalContext, systemPrompt: agentRow.systemPrompt },
    ctx,
    platform,
  }
}

function buildHarnessDeps(
  harnessByPlatform: Map<SupportedPlatform, ReturnType<typeof getOrCreateHarnessFromCredential>>,
  defaultHarness: ReturnType<typeof getOrCreateHarnessFromCredential>,
  enabledPlatforms: SupportedPlatform[],
) {
  return {
    getHarness: (_tenantId: string, _agentId: string, platformKey?: string) => {
      if (!platformKey || platformKey === '') return defaultHarness
      const n = platformKey.trim().toLowerCase()
      if (!SUPPORTED_PLATFORMS.includes(n as SupportedPlatform)) {
        throw new Error(`Unknown platform "${platformKey}" (expected one of: ${SUPPORTED_PLATFORMS.join(', ')})`)
      }
      const h = harnessByPlatform.get(n as SupportedPlatform)
      if (!h) throw new Error(`Platform "${n}" is not connected for this tenant`)
      return h
    },
    getEnabledPlatforms: () => [...enabledPlatforms],
  }
}

function buildAuditDeps(request: FastifyRequest) {
  return {
    logAction: async (tenantId: string, agentId: string, action: string, payload: unknown) => {
      await request.withDb!(async (db) => {
        await db.insert(schema.agentEvents).values({ tenantId, agentId, action, payload })
      })
    },
  }
}

function buildApprovalDeps(request: FastifyRequest, defaultPlatform: string) {
  return {
    requestApproval: async (tenantId: string, agentId: string, params: { action: string; payload: unknown }) => {
      const payloadObj = (params.payload ?? {}) as Record<string, unknown>
      const explicitPlatform =
        typeof payloadObj.platform === 'string' ? payloadObj.platform : undefined
      await request.withDb!(async (db) => {
        await db.insert(schema.approvals).values({
          tenantId,
          agentId,
          action: params.action,
          payload: { ...payloadObj, electroosPlatform: explicitPlatform ?? defaultPlatform },
          status: 'pending',
        })
      })
    },
  }
}

function buildTicketDeps(request: FastifyRequest) {
  return {
    createTicket: async (tenantId: string, agentId: string, params: { title: string; body: string }) => {
      const bridge = getExecutionServices().getBridge()
      const paperclip = await createIssueForAgentTicket(bridge, tenantId, agentId, params)
      await request.withDb!(async (db) => {
        await db.insert(schema.agentEvents).values({
          tenantId,
          agentId,
          action: 'ticket.create',
          payload: { title: params.title, body: params.body, ...paperclip } as Record<string, unknown>,
        })
      })
      if (paperclip.paperclipError) {
        request.log.warn(
          { err: paperclip.paperclipError, tenantId, agentId },
          'Paperclip createIssue failed; ticket.create audit event still recorded',
        )
      }
    },
  }
}

function buildApprovalsQueryDeps(request: FastifyRequest) {
  return {
    listPending: async (tenantId: string, agentId: string) => {
      if (!request.withDb) return []
      return request.withDb((db) =>
        db.select().from(schema.approvals).where(
          and(
            eq(schema.approvals.tenantId, tenantId),
            eq(schema.approvals.agentId, agentId),
            eq(schema.approvals.status, 'pending'),
          ),
        ),
      )
    },
  }
}

function buildEventsDeps(request: FastifyRequest) {
  return {
    getRecent: async (tenantId: string, agentId: string, limit: number) => {
      if (!request.withDb) return []
      return request.withDb((db) =>
        db.select().from(schema.agentEvents)
          .where(and(eq(schema.agentEvents.tenantId, tenantId), eq(schema.agentEvents.agentId, agentId)))
          .orderBy(desc(schema.agentEvents.createdAt))
          .limit(limit),
      )
    },
  }
}

async function executeAgentByType(
  request: FastifyRequest,
  agentRow: { id: string; type: string; goalContext: string | null },
  ctx: AgentContext,
): Promise<ExecuteAgentResponse | null> {
  const runner = getRunner(agentRow.type)
  if (!runner) return null
  return runner(request, agentRow, ctx)
}

const agentsExecuteRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/agents/:id/execute', {
    schema: { tags: ['Agent Execution'], summary: 'Execute an agent', security: [{ apiKey: [], tenantId: [] }] },
  }, async (request, reply) => {
    const authReply = await verifyPaperclipAuth(request, reply)
    if (authReply) return authReply
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid agent id' })
    }

    const agentId = parsedParams.data.id
    const loaded = await buildExecutionContext(request, agentId)
    if (!loaded.ok) {
      return reply.code(loaded.statusCode).send(loaded.body)
    }
    const { agentRow, ctx, platform } = loaded

    if ((request.query as Record<string, string>)?.probe === '1') {
      return reply.send({
        ok: true,
        probeOnly: true,
        agentId: agentRow.id,
        agentType: agentRow.type,
        platform,
      })
    }

    try {
      const budget = await getExecutionServices().getBudgetStatus(request.tenantId, agentRow.id)
      if (budget.exceeded) {
        await onBudgetExceeded(request, request.tenantId, agentRow.id, { remaining: budget.remaining })
        return reply.code(409).send({ error: 'budget exceeded', remaining: budget.remaining })
      }
      const response = await executeAgentByType(request, agentRow, ctx)
      if (!response) {
        return reply.code(501).send({ error: `agent type ${agentRow.type} not implemented` })
      }
      return reply.send(response satisfies ExecuteAgentResponse)
    } catch (error) {
      if (error instanceof HarnessError) {
        if (error.code === '401') {
          registry.invalidate(`${request.tenantId}:${platform}`)
        }
        await ctx.logAction('agent.execute.harness_error', {
          platform: error.platform,
          code: error.code,
          message: error.message,
        })
        const httpStatus =
          error.code === '429' ? 429 :
          error.code === '401' ? 503 :
          error.code === 'not_implemented' ? 501 :
          error.code === 'network_error' || error.code === 'max_retries' ? 503 :
          502
        return reply.code(httpStatus).send({
          error:
            error.code === '401'
              ? `${platform} authorization expired; please reconnect`
              : 'platform error',
          platform: error.platform,
          code: error.code,
        })
      }
      await ctx.logAction('agent.execute.error', {
        error: error instanceof Error ? error.message : 'unknown error',
      })
      return reply.code(500).send({ error: 'agent execution failed' })
    }
  })
}

export default agentsExecuteRoute
