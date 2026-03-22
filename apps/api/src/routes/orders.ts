import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { HarnessError } from '@patioer/harness'
import { z } from 'zod'
import { resolveHarness, handleHarnessError } from '../lib/resolve-harness.js'

const platformQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

const ordersRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/orders', async (request, reply) => {
    if (!request.withDb) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) => db.select().from(schema.orders))
    return reply.send({ orders: rows })
  })

  app.get('/api/v1/orders/platform', async (request, reply) => {
    const parsedQuery = platformQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'invalid query' })
    }

    const loaded = await resolveHarness(request)
    if (!loaded.ok) {
      return reply.code(loaded.statusCode).send(loaded.body)
    }
    const { harness, platform, registryKey } = loaded

    try {
      const page = await harness.getOrdersPage({
        cursor: parsedQuery.data.cursor,
        limit: parsedQuery.data.limit,
      })
      return reply.send({
        orders: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      })
    } catch (err) {
      if (err instanceof HarnessError) {
        app.log.error(
          { err, tenantId: request.tenantId, code: err.code, platform: err.platform },
          'Orders passthrough failed',
        )
        const resp = handleHarnessError(err, platform, registryKey, `failed to fetch orders from ${platform}`)
        return reply.code(resp.statusCode).send(resp.body)
      }
      app.log.error({ err, tenantId: request.tenantId }, 'Orders passthrough failed')
      return reply.code(502).send({ error: `failed to fetch orders from ${platform}` })
    }
  })
}

export default ordersRoute
