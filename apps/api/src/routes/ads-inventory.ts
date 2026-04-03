import type { FastifyPluginAsync } from 'fastify'
import { schema } from '@patioer/db'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

const campaignQuerySchema = z.object({
  campaignId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const metricsQuerySchema = z.object({
  campaignId: z.string().uuid(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const DEFAULT_LIMIT = 100

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
        security: [{ bearerAuth: [] }],
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
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.adsCampaigns)
          .orderBy(desc(schema.adsCampaigns.createdAt))
          .limit(parsed.data.limit ?? DEFAULT_LIMIT),
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
        security: [{ bearerAuth: [] }],
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
          .limit(parsed.data.limit ?? DEFAULT_LIMIT),
      )
      return reply.send({ items: rows })
    },
  )

  app.get(
    '/api/v1/ads/keywords',
    {
      schema: {
        tags: ['Ads'],
        summary: 'List keywords for a campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) return reply.code(401).send({ error: 'x-tenant-id required' })
      const parsed = campaignQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.code(400).send({ error: 'campaignId (uuid) required' })
      const { campaignId, limit } = parsed.data
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.adsKeywords)
          .where(eq(schema.adsKeywords.campaignId, campaignId))
          .orderBy(desc(schema.adsKeywords.createdAt))
          .limit(limit ?? DEFAULT_LIMIT),
      )
      return reply.send({ keywords: rows })
    },
  )

  app.get(
    '/api/v1/ads/search-terms',
    {
      schema: {
        tags: ['Ads'],
        summary: 'Search term report for a campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) return reply.code(401).send({ error: 'x-tenant-id required' })
      const parsed = metricsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.code(400).send({ error: 'campaignId (uuid) required' })
      const { campaignId, from, to, limit } = parsed.data
      const conditions = [eq(schema.adsSearchTerms.campaignId, campaignId)]
      if (from) conditions.push(gte(schema.adsSearchTerms.reportDate, from))
      if (to) conditions.push(lte(schema.adsSearchTerms.reportDate, to))
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.adsSearchTerms)
          .where(and(...conditions))
          .orderBy(desc(schema.adsSearchTerms.reportDate))
          .limit(limit ?? DEFAULT_LIMIT),
      )
      return reply.send({ searchTerms: rows })
    },
  )

  app.get(
    '/api/v1/ads/metrics-daily',
    {
      schema: {
        tags: ['Ads'],
        summary: 'Daily campaign metrics',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.withDb) return reply.code(401).send({ error: 'x-tenant-id required' })
      const parsed = metricsQuerySchema.safeParse(request.query)
      if (!parsed.success) return reply.code(400).send({ error: 'campaignId (uuid) required' })
      const { campaignId, from, to, limit } = parsed.data
      const conditions = [eq(schema.adsMetricsDaily.campaignId, campaignId)]
      if (from) conditions.push(gte(schema.adsMetricsDaily.date, from))
      if (to) conditions.push(lte(schema.adsMetricsDaily.date, to))
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.adsMetricsDaily)
          .where(and(...conditions))
          .orderBy(desc(schema.adsMetricsDaily.date))
          .limit(limit ?? DEFAULT_LIMIT),
      )
      return reply.send({ metrics: rows })
    },
  )

  app.get(
    '/api/v1/inventory',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'List inventory levels per product/platform',
        description: 'Returns `{ items: InventoryLevel[] }`. Tenant from `x-tenant-id` only.',
        security: [{ bearerAuth: [] }],
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
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.inventoryLevels)
          .orderBy(desc(schema.inventoryLevels.createdAt))
          .limit(parsed.data.limit ?? DEFAULT_LIMIT),
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
        security: [{ bearerAuth: [] }],
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
      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.inventoryLevels)
          .where(inArray(schema.inventoryLevels.status, ['low', 'out_of_stock']))
          .orderBy(desc(schema.inventoryLevels.createdAt))
          .limit(parsed.data.limit ?? DEFAULT_LIMIT),
      )
      return reply.send({ items: rows })
    },
  )
}

export default adsInventoryRoute
