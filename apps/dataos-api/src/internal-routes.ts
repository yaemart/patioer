import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { DataOsServices } from '@patioer/dataos'
import { featureCacheHits, featureCacheMisses, lakeEventsInserted } from './metrics.js'

type Services = DataOsServices

const lakeEventSchema = z.object({
  tenantId: z.string().uuid(),
  platform: z.string().optional(),
  agentId: z.string().min(1),
  eventType: z.string().min(1),
  entityId: z.string().optional(),
  payload: z.unknown(),
  metadata: z.unknown().optional(),
})

const priceEventSchema = z.object({
  tenantId: z.string().uuid(),
  platform: z.string().optional(),
  productId: z.string().min(1),
  priceBefore: z.number(),
  priceAfter: z.number(),
  changePct: z.number(),
  approved: z.boolean(),
})

function requireKey(request: FastifyRequest, reply: FastifyReply, expected: string): boolean {
  const k = request.headers['x-dataos-internal-key']
  const got = typeof k === 'string' ? k : ''
  if (got !== expected) {
    void reply.code(401).send({ error: 'unauthorized' })
    return false
  }
  return true
}

function tenantHeader(request: FastifyRequest, reply: FastifyReply): string | null {
  const t = request.headers['x-tenant-id']
  if (typeof t !== 'string' || !t) {
    void reply.code(400).send({ error: 'X-Tenant-Id required' })
    return null
  }
  return t
}

export function registerInternalRoutes(
  app: FastifyInstance,
  services: Services,
  internalKey: string,
): void {
  app.post('/internal/v1/lake/events', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const parsed = lakeEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const b = parsed.data
    await services.eventLake.insertEvent({
      tenantId: b.tenantId,
      platform: b.platform,
      agentId: b.agentId,
      eventType: b.eventType,
      entityId: b.entityId,
      payload: b.payload,
      metadata: b.metadata,
    })
    lakeEventsInserted.inc()
    return reply.send({ ok: true })
  })

  app.post('/internal/v1/lake/price-events', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const parsed = priceEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const b = parsed.data
    await services.eventLake.insertPriceEvent({
      tenantId: b.tenantId,
      platform: b.platform,
      productId: b.productId,
      priceBefore: b.priceBefore,
      priceAfter: b.priceAfter,
      changePct: b.changePct,
      approved: b.approved,
    })
    lakeEventsInserted.inc()
    return reply.send({ ok: true })
  })

  app.get('/internal/v1/features/:platform/:productId', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const tenantId = tenantHeader(request, reply)
    if (!tenantId) return
    const { platform, productId } = request.params as { platform: string; productId: string }
    const row = await services.featureStore.get(tenantId, platform, productId, {
      cacheHit: () => featureCacheHits.inc(),
      cacheMiss: () => featureCacheMisses.inc(),
    })
    return reply.send(row ?? null)
  })

  const upsertSchema = z.object({
    tenantId: z.string().uuid(),
    platform: z.string(),
    productId: z.string(),
    priceCurrent: z.number().optional(),
    convRate7d: z.number().optional(),
    competitorMinPrice: z.number().optional(),
    competitorAvgPrice: z.number().optional(),
    pricePosition: z.string().optional(),
  })

  app.post('/internal/v1/features/upsert', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const parsed = upsertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const b = parsed.data
    await services.featureStore.upsert({
      tenantId: b.tenantId,
      platform: b.platform,
      productId: b.productId,
      priceCurrent: b.priceCurrent,
      convRate7d: b.convRate7d,
      competitorMinPrice: b.competitorMinPrice,
      competitorAvgPrice: b.competitorAvgPrice,
      pricePosition: b.pricePosition,
    })
    return reply.send({ ok: true })
  })

  const recallSchema = z.object({
    agentId: z.string(),
    context: z.unknown(),
  })

  app.post('/internal/v1/memory/recall', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const tenantId = tenantHeader(request, reply)
    if (!tenantId) return
    const parsed = recallSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const memories = await services.decisionMemory.recall(tenantId, parsed.data.agentId, parsed.data.context)
    return reply.send({ memories })
  })

  const recordSchema = z.object({
    agentId: z.string(),
    platform: z.string().optional(),
    entityId: z.string().optional(),
    context: z.unknown(),
    action: z.unknown(),
  })

  app.post('/internal/v1/memory/record', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const tenantId = tenantHeader(request, reply)
    if (!tenantId) return
    const parsed = recordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const b = parsed.data
    const id = await services.decisionMemory.record({
      tenantId,
      agentId: b.agentId,
      platform: b.platform,
      entityId: b.entityId,
      context: b.context,
      action: b.action,
    })
    return reply.send({ id })
  })

  const outcomeSchema = z.object({
    tenantId: z.string().uuid(),
    decisionId: z.string().uuid(),
    outcome: z.unknown(),
  })

  app.post('/internal/v1/memory/outcome', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    const parsed = outcomeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const b = parsed.data
    await services.decisionMemory.writeOutcome(b.decisionId, b.tenantId, b.outcome)
    return reply.send({ ok: true })
  })
}
