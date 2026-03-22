import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { and, eq, isNull } from 'drizzle-orm'
import { HarnessError, ShopifyHarness } from '@patioer/harness'
import { z } from 'zod'
import { decryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'

const platformQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

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

  // GET /api/v1/orders/platform
  // Read-only passthrough to Shopify with cursor pagination.
  // Does NOT write to local DB; preserves existing /api/v1/orders semantics.
  app.get('/api/v1/orders/platform', async (request, reply) => {
    const parsedQuery = platformQuerySchema.safeParse(request.query)
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

    const accessToken = decryptToken(cred.accessToken, encryptionKey)
    const registryKey = `${request.tenantId!}:shopify`
    const harness = registry.getOrCreate(
      registryKey,
      () => new ShopifyHarness(request.tenantId!, shopDomain, accessToken),
    ) as ShopifyHarness

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
          'Shopify orders passthrough failed',
        )
        if (err.code === '401') {
          registry.invalidate(registryKey)
          return reply.code(503).send({ error: 'Shopify authorization expired; please reconnect Shopify' })
        }
        if (err.code === '429') {
          return reply.code(429).send({ error: 'Shopify rate limit exceeded; retry later' })
        }
      } else {
        app.log.error({ err, tenantId: request.tenantId }, 'Shopify orders passthrough failed')
      }
      return reply.code(502).send({ error: 'failed to fetch orders from Shopify' })
    }
  })
}

export default ordersRoute
