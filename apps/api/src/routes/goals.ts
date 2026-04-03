import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { UUID_LOOSE_RE } from '@patioer/shared'

const CATEGORIES = ['revenue', 'margin', 'acos', 'inventory', 'customer', 'custom'] as const
const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly'] as const

const createGoalBody = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  period: z.enum(PERIODS).default('monthly'),
  targetValue: z.coerce.number().positive(),
  unit: z.string().min(1).max(20).default('USD'),
  priority: z.coerce.number().int().min(0).max(100).default(0),
})

const updateGoalBody = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.enum(CATEGORIES).optional(),
  period: z.enum(PERIODS).optional(),
  targetValue: z.coerce.number().positive().optional(),
  currentValue: z.coerce.number().min(0).optional(),
  unit: z.string().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
})

const paramsSchema = z.object({ id: z.string().regex(UUID_LOOSE_RE).transform((v) => v.toLowerCase()) })

const listQuerySchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  active: z.enum(['true', 'false']).optional(),
})

const goalsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/goals', {
    schema: {
      tags: ['Goals'],
      summary: 'List tenant goals',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query params' })
    }

    const conditions = [eq(schema.tenantGoals.tenantId, request.tenantId)]
    if (query.data.category) {
      conditions.push(eq(schema.tenantGoals.category, query.data.category))
    }
    if (query.data.active) {
      conditions.push(eq(schema.tenantGoals.isActive, query.data.active === 'true'))
    }

    const rows = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantGoals)
        .where(and(...conditions))
        .orderBy(desc(schema.tenantGoals.priority), desc(schema.tenantGoals.createdAt)),
    )
    return reply.send({ goals: rows })
  })

  app.post('/api/v1/goals', {
    schema: {
      tags: ['Goals'],
      summary: 'Create a tenant goal',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsed = createGoalBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues })
    }

    const [created] = await request.withDb((db) =>
      db
        .insert(schema.tenantGoals)
        .values({
          tenantId: request.tenantId!,
          name: parsed.data.name,
          category: parsed.data.category,
          period: parsed.data.period,
          targetValue: String(parsed.data.targetValue),
          unit: parsed.data.unit,
          priority: parsed.data.priority,
        })
        .returning(),
    )
    return reply.code(201).send({ goal: created })
  })

  app.patch('/api/v1/goals/:id', {
    schema: {
      tags: ['Goals'],
      summary: 'Update a tenant goal',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid goal id' })
    }
    const parsedBody = updateGoalBody.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsedBody.error.issues })
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (parsedBody.data.name !== undefined) patch.name = parsedBody.data.name
    if (parsedBody.data.category !== undefined) patch.category = parsedBody.data.category
    if (parsedBody.data.period !== undefined) patch.period = parsedBody.data.period
    if (parsedBody.data.targetValue !== undefined) patch.targetValue = String(parsedBody.data.targetValue)
    if (parsedBody.data.currentValue !== undefined) patch.currentValue = String(parsedBody.data.currentValue)
    if (parsedBody.data.unit !== undefined) patch.unit = parsedBody.data.unit
    if (parsedBody.data.isActive !== undefined) patch.isActive = parsedBody.data.isActive
    if (parsedBody.data.priority !== undefined) patch.priority = parsedBody.data.priority

    const [updated] = await request.withDb((db) =>
      db
        .update(schema.tenantGoals)
        .set(patch)
        .where(
          and(eq(schema.tenantGoals.id, parsedParams.data.id), eq(schema.tenantGoals.tenantId, request.tenantId!)),
        )
        .returning(),
    )
    if (!updated) {
      return reply.code(404).send({ error: 'goal not found' })
    }
    return reply.send({ goal: updated })
  })

  app.delete('/api/v1/goals/:id', {
    schema: {
      tags: ['Goals'],
      summary: 'Delete a tenant goal',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid goal id' })
    }

    const [deleted] = await request.withDb((db) =>
      db
        .delete(schema.tenantGoals)
        .where(
          and(eq(schema.tenantGoals.id, parsedParams.data.id), eq(schema.tenantGoals.tenantId, request.tenantId!)),
        )
        .returning(),
    )
    if (!deleted) {
      return reply.code(404).send({ error: 'goal not found' })
    }
    return reply.code(204).send()
  })
}

export default goalsRoute
