import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { DataOsServices } from '@patioer/dataos'
import { UUID_LOOSE_RE } from '@patioer/shared'
import { featureCacheHits, featureCacheMisses, lakeEventsInserted } from './metrics.js'
import { _runInsightAgentTick } from './workers/insight-agent.js'

const zUuid = z.string().regex(UUID_LOOSE_RE).transform((v) => v.toLowerCase())

const MAX_PAYLOAD_BYTES = 65_536

const zBoundedPayload = z.unknown().refine(
  (v) => {
    const s = JSON.stringify(v ?? null)
    return s !== undefined && s.length <= MAX_PAYLOAD_BYTES
  },
  { message: `payload must be <= ${MAX_PAYLOAD_BYTES} bytes` },
)

const lakeEventSchema = z.object({
  tenantId: zUuid,
  platform: z.string().optional(),
  agentId: z.string().min(1),
  eventType: z.string().min(1),
  entityId: z.string().optional(),
  payload: zBoundedPayload,
  metadata: z.unknown().optional(),
})

const priceEventSchema = z.object({
  tenantId: zUuid,
  platform: z.string().min(1),
  productId: z.string().min(1),
  priceBefore: z.number().finite().nonnegative(),
  priceAfter: z.number().finite().nonnegative(),
  changePct: z.number().finite(),
  approved: z.boolean(),
})

function safeInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function requireKey(request: FastifyRequest, reply: FastifyReply, expectedKey: string): boolean {
  const k = request.headers['x-dataos-internal-key']
  const supplied = typeof k === 'string' ? k : ''
  const valid =
    supplied.length === expectedKey.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedKey))
  if (!valid) {
    void reply.code(401).send({ error: 'unauthorized' })
    return false
  }
  return true
}

/** Validates API key + tenant UUID header. Returns tenantId on success, null after replying with error. */
function authGuard(request: FastifyRequest, reply: FastifyReply, expectedKey: string): string | null {
  if (!requireKey(request, reply, expectedKey)) return null
  const t = request.headers['x-tenant-id']
  if (typeof t !== 'string' || !UUID_LOOSE_RE.test(t)) {
    void reply.code(400).send({ error: 'X-Tenant-Id must be a valid UUID' })
    return null
  }
  return t.toLowerCase()
}

const CAPABILITIES_RESPONSE = {
  version: '1.0.0',
  entities: {
    events: {
      operations: [
        { method: 'POST', path: '/internal/v1/lake/events', description: 'Insert a generic event into the Event Lake (ClickHouse)' },
        { method: 'GET', path: '/internal/v1/lake/events', description: 'Query events by agentId, eventType, entityId with limit and time filter', parameters: { agentId: 'string', eventType: 'string', entityId: 'string', limit: 'number', sinceMs: 'number' } },
      ],
    },
    priceEvents: {
      operations: [
        { method: 'POST', path: '/internal/v1/lake/price-events', description: 'Record a price change event' },
        { method: 'GET', path: '/internal/v1/lake/price-events', description: 'Query price events by productId with limit and time filter', parameters: { productId: 'string', limit: 'number', sinceMs: 'number' } },
      ],
    },
    features: {
      operations: [
        { method: 'GET', path: '/internal/v1/features', description: 'List product feature snapshots with optional platform filter', parameters: { platform: 'string', limit: 'number', offset: 'number' } },
        { method: 'GET', path: '/internal/v1/features/:platform/:productId', description: 'Get a single product feature snapshot' },
        { method: 'POST', path: '/internal/v1/features/upsert', description: 'Create or update a product feature row' },
        { method: 'DELETE', path: '/internal/v1/features/:platform/:productId', description: 'Delete a product feature row' },
      ],
    },
    decisions: {
      operations: [
        { method: 'POST', path: '/internal/v1/memory/recall', description: 'Semantic recall of past decisions similar to a given context (pgvector)', parameters: { agentId: 'string (required)', context: 'any (required)', limit: 'number', minSimilarity: 'number (0-1, default 0.75)' } },
        { method: 'POST', path: '/internal/v1/memory/record', description: 'Record a new decision with context and action for future recall' },
        { method: 'POST', path: '/internal/v1/memory/outcome', description: 'Write the observed outcome for a past decision (closes the feedback loop)' },
        { method: 'GET', path: '/internal/v1/memory/decisions', description: 'List recent decisions for an agent', parameters: { agentId: 'string', limit: 'number' } },
        { method: 'DELETE', path: '/internal/v1/memory/decisions/:decisionId', description: 'Delete a decision record by ID (CRUD completeness)' },
      ],
    },
  },
}

export function registerInternalRoutes(
  app: FastifyInstance,
  services: DataOsServices,
  internalKey: string,
): void {
  app.get('/internal/v1/capabilities', async (request, reply) => {
    if (!requireKey(request, reply, internalKey)) return
    return reply.send(CAPABILITIES_RESPONSE)
  })

  app.post('/internal/v1/lake/events', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = lakeEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    if (parsed.data.tenantId !== tenantId) {
      return reply.code(403).send({ error: 'body tenantId does not match X-Tenant-Id' })
    }
    await services.eventLake.insertEvent(parsed.data)
    lakeEventsInserted.inc()
    return reply.send({ ok: true })
  })

  app.post('/internal/v1/lake/price-events', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = priceEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    if (parsed.data.tenantId !== tenantId) {
      return reply.code(403).send({ error: 'body tenantId does not match X-Tenant-Id' })
    }
    await services.eventLake.insertPriceEvent(parsed.data)
    lakeEventsInserted.inc()
    return reply.send({ ok: true })
  })

  app.get('/internal/v1/lake/events', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const q = request.query as Record<string, string>
    const rows = await services.eventLake.queryEvents(tenantId, {
      agentId: q.agentId || undefined,
      eventType: q.eventType || undefined,
      entityId: q.entityId || undefined,
      limit: safeInt(q.limit),
      sinceMs: safeInt(q.sinceMs),
    })
    return reply.send({ events: rows })
  })

  app.get('/internal/v1/lake/price-events', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const q = request.query as Record<string, string>
    const rows = await services.eventLake.queryPriceEvents(tenantId, {
      productId: q.productId || undefined,
      limit: safeInt(q.limit),
      sinceMs: safeInt(q.sinceMs),
    })
    return reply.send({ events: rows })
  })

  app.get('/internal/v1/features', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const q = request.query as Record<string, string>
    const rows = await services.featureStore.list(tenantId, q.platform || undefined, {
      limit: safeInt(q.limit),
      offset: safeInt(q.offset),
    })
    return reply.send({ features: rows })
  })

  app.get('/internal/v1/features/:platform/:productId', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const { platform, productId } = request.params as { platform: string; productId: string }
    const row = await services.featureStore.get(tenantId, platform, productId, {
      cacheHit: () => featureCacheHits.inc(),
      cacheMiss: () => featureCacheMisses.inc(),
    })
    return reply.send(row ?? null)
  })

  app.delete('/internal/v1/features/:platform/:productId', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const { platform, productId } = request.params as { platform: string; productId: string }
    const deleted = await services.featureStore.delete(tenantId, platform, productId)
    return reply.send({ ok: true, deleted })
  })

  app.get('/internal/v1/memory/decisions', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const q = request.query as Record<string, string>
    const rows = await services.decisionMemory.listRecent(tenantId, q.agentId || undefined, {
      limit: safeInt(q.limit),
    })
    return reply.send({ decisions: rows })
  })

  const upsertSchema = z.object({
    tenantId: zUuid,
    platform: z.string().min(1),
    productId: z.string().min(1),
    priceCurrent: z.number().finite().nonnegative().optional(),
    convRate7d: z.number().finite().nonnegative().optional(),
    competitorMinPrice: z.number().finite().nonnegative().optional(),
    competitorAvgPrice: z.number().finite().nonnegative().optional(),
    pricePosition: z.string().optional(),
  })

  app.post('/internal/v1/features/upsert', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = upsertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    if (parsed.data.tenantId !== tenantId) {
      return reply.code(403).send({ error: 'body tenantId does not match X-Tenant-Id' })
    }
    await services.featureStore.upsert(parsed.data)
    return reply.send({ ok: true })
  })

  const recallSchema = z.object({
    agentId: z.string(),
    context: z.unknown(),
    limit: z.number().int().min(1).max(50).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
  })

  app.post('/internal/v1/memory/recall', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = recallSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const { agentId, context, limit, minSimilarity } = parsed.data
    const memories = await services.decisionMemory.recall(tenantId, agentId, context, { limit, minSimilarity })
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
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = recordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    const id = await services.decisionMemory.record({ tenantId, ...parsed.data })
    return reply.send({ id })
  })

  const outcomeSchema = z.object({
    tenantId: zUuid,
    decisionId: zUuid,
    outcome: z.unknown(),
  })

  app.post('/internal/v1/memory/outcome', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const parsed = outcomeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body' })
    }
    if (parsed.data.tenantId !== tenantId) {
      return reply.code(403).send({ error: 'body tenantId does not match X-Tenant-Id' })
    }
    await services.decisionMemory.writeOutcome(parsed.data.decisionId, tenantId, parsed.data.outcome)
    return reply.send({ ok: true })
  })

  app.delete('/internal/v1/memory/decisions/:decisionId', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const { decisionId } = request.params as { decisionId: string }
    if (!UUID_LOOSE_RE.test(decisionId)) {
      return reply.code(400).send({ error: 'decisionId must be a valid UUID' })
    }
    const deleted = await services.decisionMemory.delete(decisionId, tenantId)
    return reply.send({ ok: true, deleted })
  })

  app.post('/internal/v1/insight/trigger', async (request, reply) => {
    const tenantId = authGuard(request, reply, internalKey)
    if (!tenantId) return
    const result = await _runInsightAgentTick(services, {
      outcomeLookbackDays: 7,
      maxDecisionsPerTick: 100,
      tenantId,
    })
    return reply.send({ ok: true, ...result })
  })
}
