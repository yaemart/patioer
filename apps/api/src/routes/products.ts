import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { HarnessError } from '@patioer/harness'
import { z } from 'zod'
import { resolveHarness, handleHarnessError } from '../lib/resolve-harness.js'

const syncQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

const productsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/products', async (request, reply) => {
    if (!request.withDb) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) => db.select().from(schema.products))
    return reply.send({ products: rows })
  })

  app.post('/api/v1/products/sync', async (request, reply) => {
    const parsedQuery = syncQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'invalid query' })
    }

    const loaded = await resolveHarness(request)
    if (!loaded.ok) {
      return reply.code(loaded.statusCode).send(loaded.body)
    }
    const { harness, platform, registryKey } = loaded

    let page
    try {
      page = await harness.getProductsPage({
        cursor: parsedQuery.data.cursor,
        limit: parsedQuery.data.limit,
      })
    } catch (err) {
      if (err instanceof HarnessError) {
        app.log.error(
          { err, tenantId: request.tenantId, code: err.code, platform: err.platform },
          'Product sync failed',
        )
        const resp = handleHarnessError(err, platform, registryKey, `failed to fetch products from ${platform}`)
        return reply.code(resp.statusCode).send(resp.body)
      }
      app.log.error({ err, tenantId: request.tenantId }, 'Product sync failed')
      return reply.code(502).send({ error: `failed to fetch products from ${platform}` })
    }

    const syncedAt = new Date()
    await request.withDb!(async (db) => {
      for (const product of page.items) {
        await db
          .insert(schema.products)
          .values({
            tenantId: request.tenantId!,
            platformProductId: product.id,
            platform,
            title: product.title,
            price: product.price != null ? String(product.price) : null,
            syncedAt,
          })
          .onConflictDoUpdate({
            target: [
              schema.products.tenantId,
              schema.products.platform,
              schema.products.platformProductId,
            ],
            set: { title: product.title, price: product.price != null ? String(product.price) : null, syncedAt },
          })
      }
    })

    return reply.send({
      synced: page.items.length,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    })
  })
}

export default productsRoute
