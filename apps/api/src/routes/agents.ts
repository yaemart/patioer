import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'

// Must stay in sync with DB agentTypeEnum in packages/db/src/schema/agents.ts.
const AGENT_TYPES = [
  'product-scout',
  'price-sentinel',
  'support-relay',
  'ads-optimizer',
  'inventory-guard',
] as const

export type AgentType = (typeof AGENT_TYPES)[number]

// Per-type goalContext validation. Each agent type defines what JSON
// shape its goalContext should have. Optional fields are lenient so
// callers can omit them and get defaults at execution time.
const goalContextSchemas: Partial<Record<AgentType, z.ZodTypeAny>> = {
  'price-sentinel': z.object({
    proposals: z.array(z.object({
      productId: z.string(),
      currentPrice: z.number(),
      proposedPrice: z.number(),
      reason: z.string().optional(),
    })).optional(),
    approvalThresholdPercent: z.number().optional(),
  }).passthrough(),
  'product-scout': z.object({
    maxProducts: z.number().int().positive().optional(),
  }).passthrough(),
  'support-relay': z.object({
    autoReplyPolicy: z.enum(['auto_reply_non_refund', 'all_manual']).optional(),
  }).passthrough(),
  'ads-optimizer': z.object({
    targetRoas: z.number().positive().optional(),
  }).passthrough(),
  'inventory-guard': z.object({
    safetyThreshold: z.number().int().nonnegative().optional(),
    replenishApprovalMinUnits: z.number().int().positive().optional(),
    timeZone: z.string().optional(),
    enforceDailyWindow: z.boolean().optional(),
  }).passthrough(),
}

function validateGoalContext(type: AgentType, raw: string | undefined | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'goalContext must be valid JSON' }
  }
  const typeSchema = goalContextSchemas[type]
  if (typeSchema) {
    const result = typeSchema.safeParse(parsed)
    if (!result.success) {
      return { ok: false, error: `goalContext validation failed for ${type}: ${result.error.issues.map((i) => i.message).join(', ')}` }
    }
  }
  return { ok: true, value: raw }
}

const createAgentBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(AGENT_TYPES),
  goalContext: z.string().optional(),
  systemPrompt: z.string().optional(),
})

const updateAgentBodySchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(AGENT_TYPES).optional(),
  status: z.enum(['active', 'suspended', 'error']).optional(),
  goalContext: z.string().optional(),
  systemPrompt: z.string().nullable().optional(),
})

const paramsSchema = z.object({ id: z.string().uuid() })

const agentsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/agents', {
    schema: {
      tags: ['Agents'],
      summary: 'List all agents for tenant',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) =>
      db.select().from(schema.agents).where(eq(schema.agents.tenantId, request.tenantId!)),
    )
    return reply.send({ agents: rows })
  })

  app.post('/api/v1/agents', {
    schema: {
      tags: ['Agents'],
      summary: 'Create a new agent',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedBody = createAgentBodySchema.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    const gcResult = validateGoalContext(parsedBody.data.type, parsedBody.data.goalContext)
    if (!gcResult.ok) {
      return reply.code(400).send({ error: gcResult.error })
    }

    const [created] = await request.withDb((db) =>
      db
        .insert(schema.agents)
        .values({
          tenantId: request.tenantId!,
          name: parsedBody.data.name,
          type: parsedBody.data.type,
          goalContext: gcResult.value,
          systemPrompt: parsedBody.data.systemPrompt ?? null,
          status: 'active',
        })
        .returning(),
    )

    return reply.code(201).send({ agent: created })
  })

  app.get('/api/v1/agents/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Get agent by ID',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid agent id' })
    }

    const [row] = await request.withDb((db) =>
      db
        .select()
        .from(schema.agents)
        .where(
          and(eq(schema.agents.id, parsedParams.data.id), eq(schema.agents.tenantId, request.tenantId!)),
        )
        .limit(1),
    )

    if (!row) {
      return reply.code(404).send({ error: 'agent not found' })
    }
    return reply.send({ agent: row })
  })

  app.patch('/api/v1/agents/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Update agent',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid agent id' })
    }
    const parsedBody = updateAgentBodySchema.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    // If goalContext is being updated, we need the agent type to validate against.
    // Use the type from body (if switching type) or fetch existing row.
    let validatedGoalContext: string | null | undefined
    if (typeof parsedBody.data.goalContext !== 'undefined') {
      let agentType: AgentType | null = parsedBody.data.type ?? null
      if (!agentType) {
        const [existing] = await request.withDb!((db) =>
          db.select({ type: schema.agents.type })
            .from(schema.agents)
            .where(and(eq(schema.agents.id, parsedParams.data.id), eq(schema.agents.tenantId, request.tenantId!)))
            .limit(1),
        )
        agentType = existing?.type as AgentType ?? null
      }
      if (agentType) {
        const gcResult = validateGoalContext(agentType, parsedBody.data.goalContext)
        if (!gcResult.ok) {
          return reply.code(400).send({ error: gcResult.error })
        }
        validatedGoalContext = gcResult.value
      } else {
        validatedGoalContext = parsedBody.data.goalContext || null
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }

    if (typeof parsedBody.data.name !== 'undefined') patch.name = parsedBody.data.name
    if (typeof parsedBody.data.type !== 'undefined') patch.type = parsedBody.data.type
    if (typeof parsedBody.data.status !== 'undefined') patch.status = parsedBody.data.status
    if (typeof validatedGoalContext !== 'undefined') patch.goalContext = validatedGoalContext
    if (typeof parsedBody.data.systemPrompt !== 'undefined') patch.systemPrompt = parsedBody.data.systemPrompt ?? null

    const [updated] = await request.withDb((db) =>
      db
        .update(schema.agents)
        .set(patch)
        .where(
          and(eq(schema.agents.id, parsedParams.data.id), eq(schema.agents.tenantId, request.tenantId!)),
        )
        .returning(),
    )
    if (!updated) {
      return reply.code(404).send({ error: 'agent not found' })
    }
    return reply.send({ agent: updated })
  })

  app.delete('/api/v1/agents/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Delete agent',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid agent id' })
    }

    const [deleted] = await request.withDb((db) =>
      db
        .delete(schema.agents)
        .where(
          and(eq(schema.agents.id, parsedParams.data.id), eq(schema.agents.tenantId, request.tenantId!)),
        )
        .returning(),
    )
    if (!deleted) {
      return reply.code(404).send({ error: 'agent not found' })
    }

    return reply.code(204).send()
  })
}

export default agentsRoute
