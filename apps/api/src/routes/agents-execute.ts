import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { HarnessError, ShopifyHarness } from '@patioer/harness'
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
import { decryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'
import { createPaperclipBridgeFromEnv } from '../lib/paperclip-bridge.js'
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
  | { ok: true; agentRow: { id: string; type: string; goalContext: string | null }; ctx: AgentContext }
  | { ok: false; statusCode: number; body: { error: string } }

async function buildExecutionContext(
  request: FastifyRequest,
  agentId: string,
  encryptionKey: string,
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

  const rawCred = await request.withDb(async (db) => {
    const [globalRow] = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.tenantId, request.tenantId!),
          eq(schema.platformCredentials.platform, 'shopify'),
          eq(schema.platformCredentials.region, 'global'),
        ),
      )
      .limit(1)
    if (globalRow) return globalRow

    // Backward compatibility for old rows created before region backfill.
    const [legacyRow] = await db
      .select()
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.tenantId, request.tenantId!),
          eq(schema.platformCredentials.platform, 'shopify'),
          isNull(schema.platformCredentials.region),
        ),
      )
      .limit(1)
    return legacyRow ?? null
  })
  const cred = Array.isArray(rawCred) ? (rawCred[0] ?? null) : rawCred
  if (!cred) {
    return { ok: false, statusCode: 404, body: { error: 'No Shopify credentials' } }
  }
  const shopDomain = cred.shopDomain
  if (!shopDomain) {
    return {
      ok: false,
      statusCode: 503,
      body: { error: 'Invalid Shopify credentials: shop domain missing' },
    }
  }

  const accessToken = decryptToken(cred.accessToken, encryptionKey)
  const registryKey = `${request.tenantId}:shopify`
  const harness = registry.getOrCreate(
    registryKey,
    () => new ShopifyHarness(request.tenantId!, shopDomain, accessToken),
  )

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
              payload: params.payload as Record<string, unknown>,
              status: 'pending',
            })
          })
        },
      },
      tickets: {
        createTicket: async (tenantId, executedAgentId, params) => {
          await request.withDb!(async (db) => {
            await db.insert(schema.agentEvents).values({
              tenantId,
              agentId: executedAgentId,
              action: 'ticket.create',
              payload: params as unknown as Record<string, unknown>,
            })
          })
        },
      },
      llm: {
        complete: async (params, _context) => ({
          text: `[LLM stub] No model configured. Prompt: ${params.prompt.slice(0, 80)}`,
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
    const encryptionKey = process.env.SHOPIFY_ENCRYPTION_KEY
    if (!encryptionKey) {
      return reply.code(503).send({ error: 'Shopify integration not configured' })
    }
    const loaded = await buildExecutionContext(request, agentId, encryptionKey)
    if (!loaded.ok) {
      return reply.code(loaded.statusCode).send(loaded.body)
    }
    const { agentRow, ctx } = loaded

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
          registry.invalidate(`${request.tenantId}:shopify`)
        }
        await ctx.logAction('agent.execute.harness_error', {
          platform: error.platform,
          code: error.code,
          message: error.message,
        })
        const httpStatus = error.code === '429' ? 429 : error.code === '401' ? 503 : 502
        return reply.code(httpStatus).send({
          error:
            error.code === '401'
              ? 'Shopify authorization expired; please reconnect Shopify'
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
