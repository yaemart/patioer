import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'

const createAgentBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['product-scout', 'price-sentinel', 'support-relay']),
  goalContext: z.string().optional(),
})

const updateAgentBodySchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended', 'error']).optional(),
  goalContext: z.string().optional(),
})

const paramsSchema = z.object({ id: z.string().uuid() })

const agentsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/agents', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) =>
      db.select().from(schema.agents).where(eq(schema.agents.tenantId, request.tenantId!)),
    )
    return reply.send({ agents: rows })
  })

  app.post('/api/v1/agents', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedBody = createAgentBodySchema.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    const [created] = await request.withDb((db) =>
      db
        .insert(schema.agents)
        .values({
          tenantId: request.tenantId!,
          name: parsedBody.data.name,
          type: parsedBody.data.type,
          goalContext: parsedBody.data.goalContext ?? null,
          status: 'active',
        })
        .returning(),
    )

    return reply.code(201).send({ agent: created })
  })

  app.get('/api/v1/agents/:id', async (request, reply) => {
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

  app.patch('/api/v1/agents/:id', async (request, reply) => {
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

    const patch: {
      name?: string
      status?: 'active' | 'suspended' | 'error'
      goalContext?: string | null
      updatedAt: Date
    } = {
      updatedAt: new Date(),
    }

    if (typeof parsedBody.data.name !== 'undefined') patch.name = parsedBody.data.name
    if (typeof parsedBody.data.status !== 'undefined') patch.status = parsedBody.data.status
    if (typeof parsedBody.data.goalContext !== 'undefined') patch.goalContext = parsedBody.data.goalContext

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

  app.delete('/api/v1/agents/:id', async (request, reply) => {
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
