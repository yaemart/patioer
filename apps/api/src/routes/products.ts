import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { eq, and } from 'drizzle-orm'
import { ShopifyHarness } from '@patioer/harness'
import { decryptToken } from '../lib/crypto.js'

const productsRoute: FastifyPluginAsync = async (app) => {
  // GET /api/v1/products
  // Returns products for the authenticated tenant (RLS-enforced via withDb).
  app.get('/api/v1/products', async (request, reply) => {
    if (!request.withDb) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) => db.select().from(schema.products))
    return reply.send({ products: rows })
  })

  // POST /api/v1/products/sync
  // Fetches products from Shopify and upserts them into the local DB.
  app.post('/api/v1/products/sync', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const encryptionKey = process.env.SHOPIFY_ENCRYPTION_KEY
    if (!encryptionKey) {
      return reply.code(503).send({ error: 'Shopify integration not configured' })
    }

    const synced = await request.withDb(async (db) => {
      const [cred] = await db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, 'shopify'),
          ),
        )
        .limit(1)

      if (!cred) throw Object.assign(new Error('No Shopify credentials'), { statusCode: 404 })

      const accessToken = decryptToken(cred.accessToken, encryptionKey)
      const harness = new ShopifyHarness(request.tenantId!, cred.shopDomain, accessToken)
      const products = await harness.getProducts()
      const syncedAt = new Date()

      for (const product of products) {
        await db
          .insert(schema.products)
          .values({
            tenantId: request.tenantId!,
            platformProductId: product.id,
            platform: 'shopify',
            title: product.title,
            price: String(product.price),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: [
              schema.products.tenantId,
              schema.products.platform,
              schema.products.platformProductId,
            ],
            set: { title: product.title, price: String(product.price), syncedAt },
          })
      }

      return products.length
    })

    return reply.send({ synced })
  })
}

export default productsRoute
