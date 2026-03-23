import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { desc, inArray } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Read-only list/query params. Tenant scope comes from `x-tenant-id` → `withTenantDb` (RLS), not from query.
 */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

const DEFAULT_LIMIT = 100

function clampLimit(raw: number | undefined): number {
  const n = raw ?? DEFAULT_LIMIT
  return Math.min(Math.max(n, 1), 250)
}

/**
 * GET /api/v1/ads/campaigns — full rows from `ads_campaigns`.
 * GET /api/v1/ads/performance — campaign metrics (spend, ROAS, budgets) from the same table.
 * GET /api/v1/inventory — rows from `inventory_levels`.
 * GET /api/v1/inventory/alerts — subset where `status` is `low` or `out_of_stock`.
 */
const adsInventoryRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/ads/campaigns',
    {
      schema: {
        tags: ['Ads'],
        summary: 'List synced ad campaigns',
        description:
          'Returns `{ campaigns: AdsCampaign[] }`. Empty DB → `{ campaigns: [] }`. Tenant from `x-tenant-id` only.',
        security: [{ tenantId: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) {
        return reply.code(401).send({ error: 'x-tenant-id required' })
      }
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid query' })
      }
      const limit = clampLimit(parsed.data.limit)
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.adsCampaigns)
          .orderBy(desc(schema.adsCampaigns.createdAt))
          .limit(limit),
      )
      return reply.send({ campaigns: rows })
    },
  )

  app.get(
    '/api/v1/ads/performance',
    {
      schema: {
        tags: ['Ads'],
        summary: 'Ad campaign performance metrics',
        description:
          'Returns `{ items: [...] }` with spend/ROAS/budget fields per campaign. Same RLS scope as campaigns.',
        security: [{ tenantId: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) {
        return reply.code(401).send({ error: 'x-tenant-id required' })
      }
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid query' })
      }
      const limit = clampLimit(parsed.data.limit)
      const rows = await request.withDb((db) =>
        db
          .select({
            id: schema.adsCampaigns.id,
            platform: schema.adsCampaigns.platform,
            platformCampaignId: schema.adsCampaigns.platformCampaignId,
            name: schema.adsCampaigns.name,
            status: schema.adsCampaigns.status,
            dailyBudget: schema.adsCampaigns.dailyBudget,
            totalSpend: schema.adsCampaigns.totalSpend,
            roas: schema.adsCampaigns.roas,
            syncedAt: schema.adsCampaigns.syncedAt,
            createdAt: schema.adsCampaigns.createdAt,
          })
          .from(schema.adsCampaigns)
          .orderBy(desc(schema.adsCampaigns.createdAt))
          .limit(limit),
      )
      return reply.send({ items: rows })
    },
  )

  app.get(
    '/api/v1/inventory',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'List inventory levels per product/platform',
        description: 'Returns `{ items: InventoryLevel[] }`. Tenant from `x-tenant-id` only.',
        security: [{ tenantId: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) {
        return reply.code(401).send({ error: 'x-tenant-id required' })
      }
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid query' })
      }
      const limit = clampLimit(parsed.data.limit)
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.inventoryLevels)
          .orderBy(desc(schema.inventoryLevels.createdAt))
          .limit(limit),
      )
      return reply.send({ items: rows })
    },
  )

  app.get(
    '/api/v1/inventory/alerts',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'Low / out-of-stock inventory rows',
        description:
          'Returns `{ items: [...] }` where `status` is `low` or `out_of_stock`.',
        security: [{ tenantId: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) {
        return reply.code(401).send({ error: 'x-tenant-id required' })
      }
      const parsed = listQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid query' })
      }
      const limit = clampLimit(parsed.data.limit)
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.inventoryLevels)
          .where(inArray(schema.inventoryLevels.status, ['low', 'out_of_stock']))
          .orderBy(desc(schema.inventoryLevels.createdAt))
          .limit(limit),
      )
      return reply.send({ items: rows })
    },
  )
}

export default adsInventoryRoute
