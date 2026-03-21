import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'

const ordersRoute: FastifyPluginAsync = async (app) => {
  // GET /api/v1/orders
  // Returns orders for the authenticated tenant (RLS-enforced via withDb).
  // Orders are written by the Shopify webhook handler; this endpoint is read-only.
  app.get('/api/v1/orders', async (request, reply) => {
    if (!request.withDb) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) => db.select().from(schema.orders))
    return reply.send({ orders: rows })
  })
}

export default ordersRoute
