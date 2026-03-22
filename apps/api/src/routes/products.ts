import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { eq, and, isNull } from 'drizzle-orm'
import { HarnessError, ShopifyHarness } from '@patioer/harness'
import { z } from 'zod'
import { decryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'

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

    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const encryptionKey = process.env.SHOPIFY_ENCRYPTION_KEY
    if (!encryptionKey) {
      return reply.code(503).send({ error: 'Shopify integration not configured' })
    }

    // Step 1 — Read credential inside a short RLS transaction.
    const rawCred = await request.withDb(async (db) => {
      const [globalRow] = await db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, 'shopify'),
            eq(schema.platformCredentials.region, 'global'),
          ),
        )
        .limit(1)
      if (globalRow) return globalRow

      // Backward compatibility for old rows created before region backfill.
      const [legacyRow] = await db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, 'shopify'),
            isNull(schema.platformCredentials.region),
          ),
        )
        .limit(1)
      return legacyRow ?? null
    })
    const cred = Array.isArray(rawCred) ? (rawCred[0] ?? null) : rawCred

    if (!cred) {
      return reply.code(404).send({ error: 'No Shopify credentials' })
    }
    const shopDomain = cred.shopDomain
    if (!shopDomain) {
      return reply.code(503).send({ error: 'Invalid Shopify credentials: shop domain missing' })
    }

    // Step 2 — Fetch from Shopify OUTSIDE a PG transaction to avoid holding
    // a PoolClient while waiting on external HTTP (rate-limited at 2 req/s).
    const accessToken = decryptToken(cred.accessToken, encryptionKey)
    const registryKey = `${request.tenantId!}:shopify`
    const harness = registry.getOrCreate(
      registryKey,
      () => new ShopifyHarness(request.tenantId!, shopDomain, accessToken),
    ) as ShopifyHarness

    let page: Awaited<ReturnType<ShopifyHarness['getProductsPage']>>
    try {
      page = await harness.getProductsPage({
        cursor: parsedQuery.data.cursor,
        limit: parsedQuery.data.limit,
      })
    } catch (err) {
      if (err instanceof HarnessError) {
        app.log.error(
          { err, tenantId: request.tenantId, code: err.code, platform: err.platform },
          'Shopify product sync failed',
        )
        if (err.code === '401') {
          registry.invalidate(registryKey)
          return reply.code(503).send({ error: 'Shopify authorization expired; please reconnect Shopify' })
        }
        if (err.code === '429') {
          return reply.code(429).send({ error: 'Shopify rate limit exceeded; retry later' })
        }
      } else {
        app.log.error({ err, tenantId: request.tenantId }, 'Shopify product sync failed')
      }
      return reply.code(502).send({ error: 'failed to fetch products from Shopify' })
    }

    // Step 3 — Upsert results inside a new short RLS transaction.
    // TODO: replace sequential inserts with a batched approach once Drizzle
    // supports onConflictDoUpdate with multi-row values.
    const syncedAt = new Date()
    await request.withDb(async (db) => {
      for (const product of page.items) {
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

    return reply.send({
      synced: page.items.length,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    })
  })
}

export default productsRoute
