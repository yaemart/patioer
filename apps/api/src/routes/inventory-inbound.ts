import type { FastifyPluginAsync } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'

const inventoryInboundRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/inventory/inbound', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const shipments = await request.withDb(async (db) =>
      db
        .select()
        .from(schema.inventoryInboundShipments)
        .where(eq(schema.inventoryInboundShipments.tenantId, tenantId))
        .orderBy(desc(schema.inventoryInboundShipments.createdAt))
        .limit(200),
    )

    return reply.send({
      shipments: shipments.map((s) => ({
        id: s.id,
        platform: s.platform,
        shipmentId: s.shipmentId ?? s.id,
        status: s.status,
        quantityShipped: s.quantity,
        quantityReceived: s.status === 'delivered' ? s.quantity : 0,
        estimatedArrival: s.expectedArrival ?? null,
        createdAt: s.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    })
  })
}

export default inventoryInboundRoute
