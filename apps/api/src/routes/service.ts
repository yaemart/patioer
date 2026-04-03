import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq, gte } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { z } from 'zod'
import { AmazonHealthHarness } from '@patioer/harness'

const refundQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
})

const serviceRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/service/cases', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const cases = await request.withDb(async (db) =>
      db
        .select()
        .from(schema.serviceCases)
        .where(eq(schema.serviceCases.tenantId, tenantId))
        .orderBy(desc(schema.serviceCases.createdAt))
        .limit(200),
    )

    return reply.send({
      cases: cases.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        platform: c.platform,
        caseType: c.caseType,
        status: c.status,
        subject: c.customerMessage?.slice(0, 80) ?? null,
        description: c.customerMessage,
        amount: c.amount,
        priority: c.escalated ? 'high' : null,
        agentResponse: c.agentResponse,
        assignedTo: null,
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    })
  })

  app.get('/api/v1/service/refund-summary', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId
    const parsed = refundQuerySchema.safeParse(request.query)
    const days = parsed.success ? (parsed.data.days ?? 30) : 30

    const cutoff = new Date(Date.now() - days * 86_400_000)
    const refundCases = await request.withDb(async (db) =>
      db
        .select()
        .from(schema.serviceCases)
        .where(
          and(
            eq(schema.serviceCases.tenantId, tenantId),
            eq(schema.serviceCases.caseType, 'refund'),
            gte(schema.serviceCases.createdAt, cutoff),
          ),
        )
        .orderBy(desc(schema.serviceCases.createdAt)),
    )
    const totalRefunds = refundCases.length
    const totalAmount = refundCases.reduce((sum, c) => sum + Number(c.amount ?? 0), 0)
    const byStatus: Record<string, { count: number; amount: number }> = {}
    for (const c of refundCases) {
      const status = c.status ?? 'unknown'
      if (!byStatus[status]) byStatus[status] = { count: 0, amount: 0 }
      byStatus[status].count++
      byStatus[status].amount += Number(c.amount ?? 0)
    }

    return reply.send({ totalRefunds, totalAmount: Math.round(totalAmount * 100) / 100, byStatus, days })
  })

  app.get('/api/v1/service/threads', async (request, reply) => {
    if (!request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const harness = new AmazonHealthHarness()
    const threads = await harness.getSupportThreads()
    return reply.send({ threads })
  })
}

export default serviceRoute
