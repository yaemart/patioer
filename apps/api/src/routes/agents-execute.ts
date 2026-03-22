import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { HarnessError } from '@patioer/harness'
import {
  createAgentContext,
  runPriceSentinel,
  runProductScout,
  runSupportRelay,
  type PriceSentinelRunInput,
  type ProductScoutRunInput,
  type SupportRelayRunInput,
} from '@patioer/agent-runtime'
import type { PaperclipBridge } from '@patioer/agent-runtime'
import { registry } from '../lib/harness-registry.js'
import { createHarness, type SupportedPlatform } from '../lib/harness-factory.js'
import { resolveFirstCredential } from '../lib/resolve-credential.js'
import { createPaperclipBridgeFromEnv } from '../lib/paperclip-bridge.js'
import { createIssueForAgentTicket } from '../lib/agent-paperclip-ticket.js'
import { verifyPaperclipAuth } from '../lib/paperclip-auth.js'

const paramsSchema = z.object({ id: z.string().uuid() })

import type { PriceDecision, ScoutedProduct, RelayedThread } from '@patioer/agent-runtime'

interface ExecuteAgentResponse {
  ok: true
  agentId: string
  executedAt: string
  decisions?: PriceDecision[]
  scouted?: ScoutedProduct[]
  relayed?: RelayedThread[]
  warnings?: string[]
}

export interface BudgetStatus {
  exceeded: boolean
  remaining: number
}

const LLM_STUB_PREVIEW_MAX = 80

/**
 * Safe preview string for the execute-route LLM stub — avoids throwing when
 * `params` or `prompt` is missing, null, or not a string (agents may pass invalid data).
 */
export function previewPromptForLlmStub(params: unknown): string {
  if (params === null || params === undefined || typeof params !== 'object') {
    return ''
  }
  const raw = (params as { prompt?: unknown }).prompt
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') {
    return raw.length <= LLM_STUB_PREVIEW_MAX ? raw : raw.slice(0, LLM_STUB_PREVIEW_MAX)
  }
  try {
    return String(raw).slice(0, LLM_STUB_PREVIEW_MAX)
  } catch {
    return ''
  }
}

let _bridgeInstance: PaperclipBridge | null = null

function getBridge(): PaperclipBridge | null {
  if (!_bridgeInstance) {
    _bridgeInstance = createPaperclipBridgeFromEnv()
  }
  return _bridgeInstance
}

const _companyIdCache = new Map<string, string>()

async function resolveCompanyId(bridge: PaperclipBridge, tenantId: string): Promise<string> {
  const cached = _companyIdCache.get(tenantId)
  if (cached) return cached
  const company = await bridge.ensureCompany({ tenantId, name: `tenant-${tenantId}` })
  _companyIdCache.set(tenantId, company.id)
  return company.id
}

const _budgetCache = new Map<string, { status: BudgetStatus; expiresAt: number }>()
const BUDGET_CACHE_TTL_MS = 30_000

export function _resetCachesForTesting(): void {
  _bridgeInstance = null
  _companyIdCache.clear()
  _budgetCache.clear()
}

export async function getBudgetStatus(tenantId: string, agentId: string): Promise<BudgetStatus> {
  if (process.env.AGENT_BUDGET_FORCE_EXCEEDED === '1') {
    return { exceeded: true, remaining: 0 }
  }

  const bridge = getBridge()
  if (!bridge) {
    return { exceeded: false, remaining: Number.POSITIVE_INFINITY }
  }

  const cacheKey = `${tenantId}:${agentId}`
  const cached = _budgetCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status
  }

  try {
    const companyId = await resolveCompanyId(bridge, tenantId)
    const raw = await bridge.getBudgetStatus(companyId, agentId)
    const result: BudgetStatus = { exceeded: raw.exceeded, remaining: raw.remainingUsd }
    _budgetCache.set(cacheKey, { status: result, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS })
    return result
  } catch {
    if (process.env.AGENT_BUDGET_FAIL_OPEN === '1') {
      return { exceeded: false, remaining: Number.POSITIVE_INFINITY }
    }
    return { exceeded: true, remaining: 0 }
  }
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

function parseGoalContext(goalContext: string): Record<string, unknown> | null {
  if (!goalContext) return null
  try {
    return JSON.parse(goalContext) as Record<string, unknown>
  } catch {
    return null
  }
}

export function buildPriceSentinelInput(goalContext: string): PriceSentinelRunInput {
  const parsed = parseGoalContext(goalContext)
  if (parsed && Array.isArray(parsed.proposals)) {
    return parsed as unknown as PriceSentinelRunInput
  }
  return { proposals: [] }
}

export function buildProductScoutInput(goalContext: string): ProductScoutRunInput {
  const parsed = parseGoalContext(goalContext)
  if (!parsed) return {}
  return {
    maxProducts: typeof parsed.maxProducts === 'number' ? parsed.maxProducts : undefined,
  }
}

export function buildSupportRelayInput(goalContext: string): SupportRelayRunInput {
  const parsed = parseGoalContext(goalContext)
  if (!parsed) return {}
  const policy = parsed.policy ?? parsed.autoReplyPolicy
  if (policy === 'auto_reply_non_refund' || policy === 'all_manual') {
    return { autoReplyPolicy: policy }
  }
  return {}
}

type AgentContext = ReturnType<typeof createAgentContext>
type ExecutionLoadResult =
  | { ok: true; agentRow: { id: string; type: string; goalContext: string | null }; ctx: AgentContext; platform: SupportedPlatform }
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
    return {
      ok: false,
      statusCode: 404,
      body: { error: 'No platform credentials found' },
    }
  }

  const { cred, platform } = resolved
  const registryKey = `${request.tenantId}:${platform}`

  let harness: ReturnType<typeof createHarness>
  try {
    harness = registry.getOrCreate(registryKey, () =>
      createHarness(request.tenantId!, platform, {
        accessToken: cred.accessToken,
        shopDomain: cred.shopDomain,
        region: cred.region,
        metadata: cred.metadata,
      }),
    )
  } catch (err) {
    // createHarness can throw (missing CRED_ENCRYPTION_KEY, invalid Amazon metadata, etc.).
    // Catch here so the route handler's try/catch (HarnessError / agent execution) is not bypassed.
    request.log.warn({ err, registryKey, platform }, 'createHarness failed during agent execution load')
    return {
      ok: false,
      statusCode: 502,
      body: {
        error: err instanceof Error ? err.message : 'harness initialization failed',
      },
    }
  }

  const ctx = createAgentContext(
    {
      tenantId: request.tenantId,
      agentId: agentRow.id,
    },
    {
      harness: { getHarness: (_tenantId, _agentId) => harness },
      budget: {
        isExceeded: async (tenantId, executedAgentId) =>
          (await getBudgetStatus(tenantId, executedAgentId)).exceeded,
      },
      audit: {
        logAction: async (tenantId, executedAgentId, action, payload) => {
          await request.withDb!(async (db) => {
            await db.insert(schema.agentEvents).values({
              tenantId,
              agentId: executedAgentId,
              action,
              payload,
            })
          })
        },
      },
      approvals: {
        requestApproval: async (tenantId, executedAgentId, params) => {
          await request.withDb!(async (db) => {
            await db.insert(schema.approvals).values({
              tenantId,
              agentId: executedAgentId,
              action: params.action,
              payload: {
                ...(params.payload as Record<string, unknown>),
                /** Same harness platform as execute route / x-platform resolution. */
                electroosPlatform: platform,
              },
              status: 'pending',
            })
          })
        },
      },
      tickets: {
        createTicket: async (tenantId, executedAgentId, params) => {
          const bridge = getBridge()
          const paperclip = await createIssueForAgentTicket(bridge, tenantId, executedAgentId, params)
          await request.withDb!(async (db) => {
            await db.insert(schema.agentEvents).values({
              tenantId,
              agentId: executedAgentId,
              action: 'ticket.create',
              payload: {
                title: params.title,
                body: params.body,
                ...paperclip,
              } as Record<string, unknown>,
            })
          })
          if (paperclip.paperclipError) {
            request.log.warn(
              { err: paperclip.paperclipError, tenantId, agentId: executedAgentId },
              'Paperclip createIssue failed; ticket.create audit event still recorded',
            )
          }
        },
      },
      llm: {
        complete: async (params, _context) => ({
          text: `[LLM stub] No model configured. Prompt: ${previewPromptForLlmStub(params)}`,
        }),
      },
    },
  )

  return {
    ok: true,
    agentRow: {
      id: agentRow.id,
      type: agentRow.type,
      goalContext: agentRow.goalContext,
    },
    ctx,
    platform,
  }
}

async function executeAgentByType(
  agentRow: { id: string; type: string; goalContext: string | null },
  ctx: AgentContext,
): Promise<ExecuteAgentResponse | null> {
  switch (agentRow.type) {
    case 'price-sentinel': {
      const input = buildPriceSentinelInput(agentRow.goalContext ?? '')
      const result = await runPriceSentinel(ctx, input)
      return {
        ok: true,
        agentId: agentRow.id,
        executedAt: new Date().toISOString(),
        decisions: result.decisions,
      }
    }
    case 'product-scout': {
      const input = buildProductScoutInput(agentRow.goalContext ?? '')
      const result = await runProductScout(ctx, input)
      return {
        ok: true,
        agentId: agentRow.id,
        executedAt: new Date().toISOString(),
        scouted: result.scouted,
      }
    }
    case 'support-relay': {
      const input = buildSupportRelayInput(agentRow.goalContext ?? '')
      const result = await runSupportRelay(ctx, input)
      const warnings: string[] = []
      if (result.relayed.length === 0) {
        warnings.push('Shopify Inbox API not integrated in Phase 1 MVP — getOpenThreads returns empty')
      }
      return {
        ok: true,
        agentId: agentRow.id,
        executedAt: new Date().toISOString(),
        relayed: result.relayed,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    }
    case 'ads-optimizer':
    case 'inventory-guard': {
      await ctx.logAction('agent.execute.stub', { type: agentRow.type })
      return {
        ok: true,
        agentId: agentRow.id,
        executedAt: new Date().toISOString(),
        warnings: [`${agentRow.type} runtime not yet implemented — scheduled for Sprint 3`],
      }
    }
    default:
      return null
  }
}

const agentsExecuteRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/agents/:id/execute', {
    schema: { tags: ['Agent Execution'], summary: 'Execute an agent', security: [{ apiKey: [], tenantId: [] }] },
  }, async (request, reply) => {
    const authReply = verifyPaperclipAuth(request, reply)
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

    try {
      const budget = await getBudgetStatus(request.tenantId, agentRow.id)
      if (budget.exceeded) {
        await onBudgetExceeded(request, request.tenantId, agentRow.id, { remaining: budget.remaining })
        return reply.code(409).send({ error: 'budget exceeded', remaining: budget.remaining })
      }
      const response = await executeAgentByType(agentRow, ctx)
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
