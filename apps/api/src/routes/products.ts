import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { eq, and } from 'drizzle-orm'
import { ShopifyHarness } from '@patioer/harness'
import { decryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'

const productsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/products', async (request, reply) => {
    if (!request.withDb) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) => db.select().from(schema.products))
    return reply.send({ products: rows })
  })

  app.post('/api/v1/products/sync', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const encryptionKey = process.env.SHOPIFY_ENCRYPTION_KEY
    if (!encryptionKey) {
      return reply.code(503).send({ error: 'Shopify integration not configured' })
    }

    // Step 1 — Read credential inside a short RLS transaction.
    const cred = await request.withDb(async (db) => {
      const [row] = await db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, 'shopify'),
          ),
        )
        .limit(1)
      return row ?? null
    })

    if (!cred) {
      return reply.code(404).send({ error: 'No Shopify credentials' })
    }

    // Step 2 — Fetch from Shopify OUTSIDE a PG transaction to avoid holding
    // a PoolClient while waiting on external HTTP (rate-limited at 2 req/s).
    const accessToken = decryptToken(cred.accessToken, encryptionKey)
    const registryKey = `${request.tenantId!}:shopify`
    const harness = registry.getOrCreate(
      registryKey,
      () => new ShopifyHarness(request.tenantId!, cred.shopDomain, accessToken),
    ) as ShopifyHarness
    const products = await harness.getProducts()

    // Step 3 — Upsert results inside a new short RLS transaction.
    // TODO: replace sequential inserts with a batched approach once Drizzle
    // supports onConflictDoUpdate with multi-row values.
    const syncedAt = new Date()
    await request.withDb(async (db) => {
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
    })

    return reply.send({ synced: products.length })
  })
}

export default productsRoute
