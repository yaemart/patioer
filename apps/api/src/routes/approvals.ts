import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'

const paramsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

const resolveBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  resolvedBy: z.string().min(1),
})

const approvalsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/approvals', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query' })
    }

    const rows = await request.withDb((db) => {
      if (query.data.status) {
        return db
          .select()
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.tenantId, request.tenantId!),
              eq(schema.approvals.status, query.data.status),
            ),
          )
      }
      return db.select().from(schema.approvals).where(eq(schema.approvals.tenantId, request.tenantId!))
    })

    return reply.send({ approvals: rows })
  })

  app.get('/api/v1/approvals/:id', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid approval id' })
    }

    const [row] = await request.withDb((db) =>
      db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, parsedParams.data.id),
            eq(schema.approvals.tenantId, request.tenantId!),
          ),
        )
        .limit(1),
    )
    if (!row) {
      return reply.code(404).send({ error: 'approval not found' })
    }

    return reply.send({ approval: row })
  })

  app.patch('/api/v1/approvals/:id/resolve', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid approval id' })
    }
    const parsedBody = resolveBodySchema.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    const [existing] = await request.withDb((db) =>
      db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, parsedParams.data.id),
            eq(schema.approvals.tenantId, request.tenantId!),
          ),
        )
        .limit(1),
    )
    if (!existing) {
      return reply.code(404).send({ error: 'approval not found' })
    }
    if (existing.status !== 'pending') {
      if (existing.status === parsedBody.data.status) {
        return reply.send({ approval: existing })
      }
      return reply.code(409).send({ error: 'approval already resolved' })
    }

    const result = await request.withDb(async (db) => {
      const [updated] = await db
        .update(schema.approvals)
        .set({
          status: parsedBody.data.status,
          resolvedBy: parsedBody.data.resolvedBy,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(schema.approvals.id, parsedParams.data.id),
            eq(schema.approvals.tenantId, request.tenantId!),
            eq(schema.approvals.status, 'pending'),
          ),
        )
        .returning()

      if (!updated) return null

      await db.insert(schema.agentEvents).values({
        tenantId: request.tenantId!,
        agentId: existing.agentId,
        action: `approval.resolved.${parsedBody.data.status}`,
        payload: {
          approvalId: existing.id,
          resolvedBy: parsedBody.data.resolvedBy,
        },
      })

      return updated
    })

    if (!result || (Array.isArray(result) && result.length === 0)) {
      return reply.code(409).send({ error: 'approval already resolved' })
    }

    return reply.send({ approval: result })
  })
}

export default approvalsRoute
