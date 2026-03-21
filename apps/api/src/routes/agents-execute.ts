import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { HarnessError, ShopifyHarness } from '@patioer/harness'
import {
  PaperclipBridge,
  createAgentContext,
  runPriceSentinel,
  runProductScout,
  runSupportRelay,
  type PriceSentinelRunInput,
  type ProductScoutRunInput,
  type SupportRelayRunInput,
} from '@patioer/agent-runtime'
import { decryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'
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
  const baseUrl = process.env.PAPERCLIP_API_URL
  const apiKey = process.env.PAPERCLIP_API_KEY
  if (!baseUrl || !apiKey) return null
  if (!_bridgeInstance) {
    _bridgeInstance = new PaperclipBridge({
      baseUrl,
      apiKey,
      timeoutMs: Number(process.env.PAPERCLIP_TIMEOUT_MS ?? 5000),
      maxRetries: Number(process.env.PAPERCLIP_MAX_RETRIES ?? 2),
      retryBaseMs: Number(process.env.PAPERCLIP_RETRY_BASE_MS ?? 200),
    })
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
    await db.insert(schema.agentEvents).values({
      tenantId,
      agentId,
      action: 'agent.execute.blocked.budget_exceeded',
      payload: details,
    })
  })
}

export function buildPriceSentinelInput(goalContext: string): PriceSentinelRunInput {
  if (!goalContext) {
    return { proposals: [] }
  }

  try {
    const parsed = JSON.parse(goalContext) as Record<string, unknown>
    if (parsed && Array.isArray(parsed.proposals)) {
      return parsed as unknown as PriceSentinelRunInput
    }
  } catch {
    // fall through
  }
  return { proposals: [] }
}

export function buildProductScoutInput(goalContext: string): ProductScoutRunInput {
  if (!goalContext) return {}
  try {
    const parsed = JSON.parse(goalContext) as Record<string, unknown>
    return {
      maxProducts:
        typeof parsed.maxProducts === 'number' ? parsed.maxProducts : undefined,
    }
  } catch {
    return {}
  }
}

export function buildSupportRelayInput(goalContext: string): SupportRelayRunInput {
  if (!goalContext) return {}
  try {
    const parsed = JSON.parse(goalContext) as Record<string, unknown>
    const policy = parsed.policy ?? parsed.autoReplyPolicy
    if (policy === 'auto_reply_non_refund' || policy === 'all_manual') {
      return { autoReplyPolicy: policy }
    }
  } catch {
    // fall through
  }
  return {}
}

const agentsExecuteRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/agents/:id/execute', async (request, reply) => {
    if (!verifyPaperclipAuth(request, reply)) {
      return reply
    }
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

    const [agentRow] = await request.withDb((db) =>
      db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, request.tenantId!)))
        .limit(1),
    )

    if (!agentRow) {
      return reply.code(404).send({ error: 'agent not found' })
    }

    const [cred] = await request.withDb((db) =>
      db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, 'shopify'),
          ),
        )
        .limit(1),
    )
    if (!cred) {
      return reply.code(404).send({ error: 'No Shopify credentials' })
    }

    const accessToken = decryptToken(cred.accessToken, encryptionKey)
    const registryKey = `${request.tenantId}:shopify`
    const harness = registry.getOrCreate(
      registryKey,
      () => new ShopifyHarness(request.tenantId!, cred.shopDomain, accessToken),
    )

    const ctx = createAgentContext(
      {
        tenantId: request.tenantId,
        agentId: agentRow.id,
      },
      {
        harness: { getHarness: () => harness },
        budget: {
          isExceeded: async () => (await getBudgetStatus(request.tenantId!, agentRow.id)).exceeded,
        },
        audit: {
          logAction: async (tenantId, id, action, payload) => {
            await request.withDb!(async (db) => {
              await db.insert(schema.agentEvents).values({
                tenantId,
                agentId: id,
                action,
                payload,
              })
            })
          },
        },
        approvals: {
          requestApproval: async (tenantId, id, params) => {
            await request.withDb!(async (db) => {
              await db.insert(schema.approvals).values({
                tenantId,
                agentId: id,
                action: params.action,
                payload: params.payload as Record<string, unknown>,
                status: 'pending',
              })
            })
          },
        },
        tickets: {
          createTicket: async (tenantId, id, params) => {
            await request.withDb!(async (db) => {
              await db.insert(schema.agentEvents).values({
                tenantId,
                agentId: id,
                action: 'ticket.create',
                payload: params as unknown as Record<string, unknown>,
              })
            })
          },
        },
        llm: {
          complete: async () => ({ text: '' }),
        },
      },
    )

    try {
      const budget = await getBudgetStatus(request.tenantId, agentRow.id)
      if (budget.exceeded) {
        await onBudgetExceeded(request, request.tenantId, agentRow.id, { remaining: budget.remaining })
        return reply.code(409).send({ error: 'budget exceeded', remaining: budget.remaining })
      }

      switch (agentRow.type) {
        case 'price-sentinel': {
          const input = buildPriceSentinelInput(agentRow.goalContext ?? '')
          const result = await runPriceSentinel(ctx, input)
          return reply.send({
            ok: true,
            agentId: agentRow.id,
            executedAt: new Date().toISOString(),
            decisions: result.decisions,
          } satisfies ExecuteAgentResponse)
        }
        case 'product-scout': {
          const input = buildProductScoutInput(agentRow.goalContext ?? '')
          const result = await runProductScout(ctx, input)
          return reply.send({
            ok: true,
            agentId: agentRow.id,
            executedAt: new Date().toISOString(),
            scouted: result.scouted,
          } satisfies ExecuteAgentResponse)
        }
        case 'support-relay': {
          const input = buildSupportRelayInput(agentRow.goalContext ?? '')
          const result = await runSupportRelay(ctx, input)
          const warnings: string[] = []
          if (result.relayed.length === 0) {
            warnings.push(
              'Shopify Inbox API not integrated in Phase 1 MVP — getOpenThreads returns empty',
            )
          }
          return reply.send({
            ok: true,
            agentId: agentRow.id,
            executedAt: new Date().toISOString(),
            relayed: result.relayed,
            ...(warnings.length > 0 ? { warnings } : {}),
          } satisfies ExecuteAgentResponse)
        }
        default:
          return reply.code(501).send({ error: `agent type ${agentRow.type} not implemented` })
      }
    } catch (error) {
      if (error instanceof HarnessError) {
        await ctx.logAction('agent.execute.harness_error', {
          platform: error.platform,
          code: error.code,
          message: error.message,
        })
        const httpStatus = error.code === '429' ? 429 : 502
        return reply.code(httpStatus).send({
          error: 'platform error',
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
