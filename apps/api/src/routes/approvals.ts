import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { enqueueJob } from '../lib/queue-factory.js'
import { optionalPlatformZod } from '../lib/platform-schema.js'
import { parseElectroosPlatformFromPayload } from '../lib/resolve-credential.js'

const paramsSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  agentId: z.string().uuid().optional(),
})

const resolveBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  resolvedBy: z.string().min(1),
  /** Overrides stored `electroosPlatform` on the approval payload (e.g. legacy rows). */
  platform: optionalPlatformZod,
})

const approvalsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/approvals', {
    schema: { tags: ['Approvals'], summary: 'List approvals (optionally filter by status)', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query' })
    }

    const rows = await request.withDb((db) => {
      const conditions = [eq(schema.approvals.tenantId, request.tenantId!)]
      if (query.data.status) conditions.push(eq(schema.approvals.status, query.data.status))
      if (query.data.agentId) conditions.push(eq(schema.approvals.agentId, query.data.agentId))
      return db.select().from(schema.approvals).where(and(...conditions))
    })

    return reply.send({ approvals: rows })
  })

  app.get('/api/v1/approvals/:id', {
    schema: { tags: ['Approvals'], summary: 'Get approval by ID', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
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

  app.patch('/api/v1/approvals/:id/resolve', {
    schema: { tags: ['Approvals'], summary: 'Resolve an approval (approve or reject)', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
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

    const updatedApproval = await request.withDb(async (db) => {
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

      return updated ?? null
    })

    const normalizedApproval = Array.isArray(updatedApproval)
      ? (updatedApproval[0] ?? null)
      : updatedApproval

    if (!normalizedApproval) {
      return reply.code(409).send({ error: 'approval already resolved' })
    }

    // When an approval is approved, enqueue a job so the agent can execute the
    // approved action asynchronously. The webhook-processing queue worker will
    // pick it up and call the appropriate harness method.
    if (parsedBody.data.status === 'approved') {
      try {
        const jobPlatform =
          parsedBody.data.platform ?? parseElectroosPlatformFromPayload(existing.payload)
        await enqueueJob('webhook-processing', 'approval.execute', {
          tenantId: request.tenantId!,
          agentId: existing.agentId,
          approvalId: existing.id,
          action: existing.action,
          payload: existing.payload,
          ...(jobPlatform ? { platform: jobPlatform } : {}),
        })
      } catch (err) {
        // Non-fatal — the approval is already resolved. Log and continue.
        request.log.error({ err, approvalId: existing.id }, 'failed to enqueue approved action')
      }
    }

    return reply.send({ approval: normalizedApproval })
  })

  // Allow operators to delete resolved/stale approvals.
  app.delete('/api/v1/approvals/:id', {
    schema: { tags: ['Approvals'], summary: 'Delete an approval', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid approval id' })
    }

    const [deleted] = await request.withDb((db) =>
      db
        .delete(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, parsedParams.data.id),
            eq(schema.approvals.tenantId, request.tenantId!),
          ),
        )
        .returning(),
    )
    if (!deleted) {
      return reply.code(404).send({ error: 'approval not found' })
    }
    return reply.code(204).send()
  })
}

export default approvalsRoute
