import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'

const listQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const agentEventsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/agent-events', {
    schema: {
      tags: ['Agent Events'],
      summary: 'List agent execution events (audit log)',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query params' })
    }

    const { agentId, action, limit, offset } = query.data

    const rows = await request.withDb((db) => {
      const conditions = [eq(schema.agentEvents.tenantId, request.tenantId!)]
      if (agentId) conditions.push(eq(schema.agentEvents.agentId, agentId))
      if (action) conditions.push(eq(schema.agentEvents.action, action))

      return db
        .select()
        .from(schema.agentEvents)
        .where(and(...conditions))
        .orderBy(desc(schema.agentEvents.createdAt))
        .limit(limit)
        .offset(offset)
    })

    return reply.send({ events: rows, limit, offset })
  })
}

export default agentEventsRoute
