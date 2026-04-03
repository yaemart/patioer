import type { FastifyPluginAsync } from 'fastify'
import { and, eq, lte } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { UUID_LOOSE_RE } from '@patioer/shared'
import { enqueueJob } from '../lib/queue-factory.js'
import { optionalPlatformZod } from '../lib/platform-schema.js'
import { parseElectroosPlatformFromPayload } from '../lib/resolve-credential.js'

const zUuid = z.string().regex(UUID_LOOSE_RE).transform((v) => v.toLowerCase())

const paramsSchema = z.object({ id: zUuid })

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
  agentId: zUuid.optional(),
  action: z.string().optional(),
})

const resolveBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  resolvedBy: z.string().min(1),
  platform: optionalPlatformZod,
})

const batchResolveBodySchema = z.object({
  ids: z.array(zUuid).min(1).max(50),
  status: z.enum(['approved', 'rejected']),
  resolvedBy: z.string().min(1),
})

type ApprovalRow = typeof schema.approvals.$inferSelect

function normalizeGuard(payload: unknown): { effect: 'require_approval'; reason: string } | null {
  const record = payload as Record<string, unknown> | null | undefined
  const reason = typeof record?.businessGuardReason === 'string' ? record.businessGuardReason : null
  if (!reason) return null
  return {
    effect: 'require_approval',
    reason,
  }
}

function extractPipelineFields(payload: unknown) {
  const p = payload as Record<string, unknown> | null | undefined
  return {
    autoApprovable: typeof p?.autoApprovable === 'boolean' ? p.autoApprovable : undefined,
    autoApproveReason: typeof p?.autoApproveReason === 'string' ? p.autoApproveReason : undefined,
    confidence: typeof p?.confidence === 'number' ? p.confidence : undefined,
  }
}

function normalizeApproval(row: ApprovalRow) {
  const guard = normalizeGuard(row.payload)
  const pipeline = extractPipelineFields(row.payload)
  return {
    ...row,
    ...(guard ? { guard } : {}),
    ...pipeline,
  }
}

const approvalsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/approvals', {
    schema: { tags: ['Approvals'], summary: 'List approvals (optionally filter by status)', security: [{ bearerAuth: [] }] },
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
      if (query.data.action) conditions.push(eq(schema.approvals.action, query.data.action))
      return db.select().from(schema.approvals).where(and(...conditions))
    })

    return reply.send({ approvals: rows.map(normalizeApproval) })
  })

  app.get('/api/v1/approvals/:id', {
    schema: { tags: ['Approvals'], summary: 'Get approval by ID', security: [{ bearerAuth: [] }] },
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

    return reply.send({ approval: normalizeApproval(row) })
  })

  app.patch('/api/v1/approvals/:id/resolve', {
    schema: { tags: ['Approvals'], summary: 'Resolve an approval (approve or reject)', security: [{ bearerAuth: [] }] },
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
        return reply.send({ approval: normalizeApproval(existing) })
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

    return reply.send({ approval: normalizeApproval(normalizedApproval) })
  })

  app.post('/api/v1/approvals/batch-resolve', {
    schema: { tags: ['Approvals'], summary: 'Batch resolve up to 50 approvals', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsed = batchResolveBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    const tenantId = request.tenantId
    const { ids, status, resolvedBy } = parsed.data

    const results = await request.withDb(async (db) => {
      const resolved: string[] = []
      const skipped: string[] = []
      const approvedJobs: Array<{
        approvalId: string
        agentId: string
        action: string
        payload: unknown
        platform?: string
      }> = []

      for (const id of ids) {
        const [existing] = await db
          .select()
          .from(schema.approvals)
          .where(and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.tenantId, tenantId),
          ))
          .limit(1)

        if (!existing || existing.status !== 'pending') {
          skipped.push(id)
          continue
        }

        const [updated] = await db
          .update(schema.approvals)
          .set({ status, resolvedBy, resolvedAt: new Date() })
          .where(and(
            eq(schema.approvals.id, id),
            eq(schema.approvals.tenantId, tenantId),
            eq(schema.approvals.status, 'pending'),
          ))
          .returning({ id: schema.approvals.id })

        if (updated) {
          resolved.push(updated.id)
          await db.insert(schema.agentEvents).values({
            tenantId,
            agentId: existing.agentId,
            action: `approval.resolved.${status}`,
            payload: {
              approvalId: existing.id,
              resolvedBy,
              batch: true,
            },
          })
          if (status === 'approved') {
            const platform = parseElectroosPlatformFromPayload(existing.payload)
            approvedJobs.push({
              approvalId: existing.id,
              agentId: existing.agentId,
              action: existing.action,
              payload: existing.payload,
              ...(platform ? { platform } : {}),
            })
          }
        } else {
          skipped.push(id)
        }
      }

      return { resolved, skipped, approvedJobs }
    })

    if (status === 'approved') {
      for (const job of results.approvedJobs) {
        try {
          await enqueueJob('webhook-processing', 'approval.execute', {
            tenantId,
            agentId: job.agentId,
            approvalId: job.approvalId,
            action: job.action,
            payload: job.payload,
            ...(job.platform ? { platform: job.platform } : {}),
          })
        } catch (err) {
          request.log.error({ err, approvalId: job.approvalId }, 'failed to enqueue approved batch action')
        }
      }
    }

    return reply.send({
      resolvedCount: results.resolved.length,
      skippedCount: results.skipped.length,
      resolved: results.resolved,
      skipped: results.skipped,
    })
  })

  app.post('/api/v1/approvals/expire-sweep', {
    schema: { tags: ['Approvals'], summary: 'Mark expired approvals (called by cron or manually)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const now = new Date()
    const expired = await request.withDb(async (db) => {
      return db
        .update(schema.approvals)
        .set({ status: 'expired', resolvedAt: now })
        .where(and(
          eq(schema.approvals.tenantId, request.tenantId!),
          eq(schema.approvals.status, 'pending'),
          lte(schema.approvals.expireAt, now),
        ))
        .returning({ id: schema.approvals.id })
    })

    return reply.send({ expiredCount: expired.length })
  })

  // Allow operators to delete resolved/stale approvals.
  app.delete('/api/v1/approvals/:id', {
    schema: { tags: ['Approvals'], summary: 'Delete an approval', security: [{ bearerAuth: [] }] },
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
