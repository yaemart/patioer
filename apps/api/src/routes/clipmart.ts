import type { FastifyPluginAsync } from 'fastify'
import {
  createTemplateService,
  createReviewService,
  createImportService,
  validateTemplateConfig,
  applyTemplateFilters,
  ClipmartError,
} from '@patioer/clipmart'
import type {
  TemplateService,
  ReviewService,
  ImportService,
  TemplateStore,
  ReviewStore,
  AgentManager,
  EventRecorder,
  ClipmartTemplate,
  TemplateReview,
} from '@patioer/clipmart'
import { schema, withTenantDb } from '@patioer/db'
import { and, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { extractJwtToken, verifyJwt } from './auth.js'
import {
  createDbClipmartAgentManager,
  createDbClipmartEventRecorder,
} from '../lib/clipmart-runtime.js'

const ANONYMOUS_RLS_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const CLIPMART_WRITE_ROLES = new Set(['owner', 'admin', 'seller', 'service'])
let _clipmartDeps: ClipmartRouteDeps = {}

export interface ClipmartRouteDeps {
  templateStore?: TemplateStore
  reviewStore?: ReviewStore
  templateStoreFactory?: (actorTenantId: string | null) => TemplateStore
  reviewStoreFactory?: (actorTenantId: string | null) => ReviewStore
  agentManager?: AgentManager
  eventRecorder?: EventRecorder
}

export function setClipmartDeps(deps: ClipmartRouteDeps): void {
  _clipmartDeps = deps
}

function getTemplateService(actorTenantId: string | null): TemplateService {
  const templateStore = _clipmartDeps.templateStore
    ?? _clipmartDeps.templateStoreFactory?.(actorTenantId)
    ?? createDbTemplateStore(actorTenantId)
  return createTemplateService({
    store: templateStore,
    generateId: () => randomUUID(),
  })
}

function getReviewService(actorTenantId: string | null): ReviewService {
  const templateStore = _clipmartDeps.templateStore
    ?? _clipmartDeps.templateStoreFactory?.(actorTenantId)
    ?? createDbTemplateStore(actorTenantId)
  const reviewStore = _clipmartDeps.reviewStore
    ?? _clipmartDeps.reviewStoreFactory?.(actorTenantId)
    ?? createDbReviewStore(actorTenantId)
  return createReviewService({
    reviewStore,
    templateStore,
    generateId: () => randomUUID(),
  })
}

function getImportService(actorTenantId: string): ImportService {
  const templateStore = _clipmartDeps.templateStore
    ?? _clipmartDeps.templateStoreFactory?.(actorTenantId)
    ?? createDbTemplateStore(actorTenantId)
  return createImportService({
    templateStore,
    agentManager: _clipmartDeps.agentManager ?? createDbClipmartAgentManager(),
    eventRecorder: _clipmartDeps.eventRecorder ?? createDbClipmartEventRecorder(),
  })
}

interface ClipmartAuthContext {
  tenantId: string
  role: string
}

function extractAuthContext(
  request: {
    headers: Record<string, string | string[] | undefined>
    auth?: { tenantId: string; role: string } | null
    tenantId?: string
  },
): ClipmartAuthContext | null {
  const headerTid = request.headers['x-tenant-id']
  const fromHeader = typeof headerTid === 'string' && headerTid.length > 0 ? headerTid : null
  if (request.auth && request.tenantId) {
    if (fromHeader && fromHeader !== request.tenantId) return null
    return { tenantId: request.tenantId, role: request.auth.role }
  }

  const token = extractJwtToken(request.headers)
  if (!token) return null
  const payload = verifyJwt(token)
  if (!payload) return null
  if (fromHeader && fromHeader !== payload.tenantId) return null
  return { tenantId: payload.tenantId, role: payload.role }
}

const ERROR_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const },
    message: { type: 'string' as const },
  },
}

function parsePaginationParam(
  value: string | undefined,
  field: 'limit' | 'offset',
): number | null {
  if (value === undefined) return field === 'limit' ? 20 : 0
  if (!/^\d+$/.test(value)) return null

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return null
  if (field === 'limit') {
    if (parsed < 1 || parsed > 100) return null
    return parsed
  }
  return parsed >= 0 ? parsed : null
}

interface SearchQuery {
  query?: string
  category?: string
  market?: string
  markets?: string
  platforms?: string
  official?: string
  limit?: string
  offset?: string
}

interface CreateTemplateBody {
  name: string
  description?: string
  category: string
  targetMarkets?: string[]
  targetCategories?: string[]
  platforms?: string[]
  config: Record<string, unknown>
}

interface ImportBody {
  overrides?: Record<string, unknown>
}

interface ReviewBody {
  rating: number
  comment?: string
  gmvChange?: number
}

function canWriteClipmart(role: string): boolean {
  return CLIPMART_WRITE_ROLES.has(role)
}

function toTemplate(row: typeof schema.clipmartTemplates.$inferSelect): ClipmartTemplate {
  return {
    id: row.id,
    authorTenantId: row.authorTenantId ?? null,
    name: row.name,
    description: row.description ?? null,
    category: row.category,
    targetMarkets: row.targetMarkets ?? [],
    targetCategories: row.targetCategories ?? [],
    platforms: row.platforms ?? [],
    config: (row.config ?? {}) as Record<string, unknown>,
    performance: (row.performance ?? {}) as Record<string, unknown>,
    downloads: row.downloads,
    rating: row.rating === null ? null : Number(row.rating),
    isOfficial: row.isOfficial,
    isPublic: row.isPublic,
    createdAt: row.createdAt ?? new Date(),
    deletedAt: row.deletedAt ?? null,
  }
}

function toReview(row: typeof schema.templateReviews.$inferSelect): TemplateReview {
  return {
    id: row.id,
    templateId: row.templateId,
    tenantId: row.tenantId,
    rating: row.rating,
    comment: row.comment ?? null,
    gmvChange: row.gmvChange === null ? null : Number(row.gmvChange),
    createdAt: row.createdAt ?? new Date(),
    deletedAt: row.deletedAt ?? null,
  }
}

function toPublicReview(review: TemplateReview) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    gmvChange: review.gmvChange,
    createdAt: review.createdAt,
  }
}

function createDbTemplateStore(actorTenantId: string | null): TemplateStore {
  const rlsTenantId = actorTenantId ?? ANONYMOUS_RLS_TENANT_ID

  return {
    async create(input) {
      await withTenantDb(input.authorTenantId, async (tdb) => {
        await tdb.insert(schema.clipmartTemplates).values({
          id: input.id,
          authorTenantId: input.authorTenantId,
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          targetMarkets: input.targetMarkets ?? [],
          targetCategories: input.targetCategories ?? [],
          platforms: input.platforms ?? [],
          config: input.config,
          performance: {},
          downloads: 0,
          rating: null,
          isOfficial: input.isOfficial ?? false,
          isPublic: true,
        })
      })
    },

    async getById(id) {
      return withTenantDb(rlsTenantId, async (tdb) => {
        const [row] = await tdb
          .select()
          .from(schema.clipmartTemplates)
          .where(and(eq(schema.clipmartTemplates.id, id), isNull(schema.clipmartTemplates.deletedAt)))
          .limit(1)
        return row ? toTemplate(row) : null
      })
    },

    async search(filters) {
      return withTenantDb(rlsTenantId, async (tdb) => {
        const rows = await tdb
          .select()
          .from(schema.clipmartTemplates)
          .where(isNull(schema.clipmartTemplates.deletedAt))
        return applyTemplateFilters(rows.map(toTemplate), filters)
      })
    },

    async incrementDownloads(id) {
      return withTenantDb(actorTenantId ?? ANONYMOUS_RLS_TENANT_ID, async (tdb) => {
        const [row] = await tdb
          .select({ downloads: schema.clipmartTemplates.downloads })
          .from(schema.clipmartTemplates)
          .where(and(eq(schema.clipmartTemplates.id, id), isNull(schema.clipmartTemplates.deletedAt)))
          .limit(1)
        if (!row) return 0
        const downloads = row.downloads + 1
        await tdb
          .update(schema.clipmartTemplates)
          .set({ downloads })
          .where(eq(schema.clipmartTemplates.id, id))
        return downloads
      })
    },

    async updateRating(id, avgRating) {
      await withTenantDb(actorTenantId ?? ANONYMOUS_RLS_TENANT_ID, async (tdb) => {
        await tdb
          .update(schema.clipmartTemplates)
          .set({ rating: String(avgRating) })
          .where(eq(schema.clipmartTemplates.id, id))
      })
    },

    async softDelete(id) {
      if (!actorTenantId) return false
      return withTenantDb(actorTenantId, async (tdb) => {
        const [row] = await tdb
          .update(schema.clipmartTemplates)
          .set({ deletedAt: new Date() })
          .where(and(eq(schema.clipmartTemplates.id, id), isNull(schema.clipmartTemplates.deletedAt)))
          .returning({ id: schema.clipmartTemplates.id })
        return Boolean(row)
      })
    },
  }
}

function createDbReviewStore(actorTenantId: string | null): ReviewStore {
  const rlsTenantId = actorTenantId ?? ANONYMOUS_RLS_TENANT_ID

  return {
    async create(review) {
      await withTenantDb(review.tenantId, async (tdb) => {
        await tdb.insert(schema.templateReviews).values({
          id: review.id,
          templateId: review.templateId,
          tenantId: review.tenantId,
          rating: review.rating,
          comment: review.comment ?? null,
          gmvChange: review.gmvChange === null ? null : String(review.gmvChange),
        })
      })
    },

    async getByTemplate(templateId, limit, offset) {
      return withTenantDb(rlsTenantId, async (tdb) => {
        const rows = await tdb
          .select()
          .from(schema.templateReviews)
          .where(and(eq(schema.templateReviews.templateId, templateId), isNull(schema.templateReviews.deletedAt)))
        return rows.map(toReview).slice(offset, offset + limit)
      })
    },

    async calcAvgRating(templateId) {
      return withTenantDb(rlsTenantId, async (tdb) => {
        const rows = await tdb
          .select({ rating: schema.templateReviews.rating })
          .from(schema.templateReviews)
          .where(and(eq(schema.templateReviews.templateId, templateId), isNull(schema.templateReviews.deletedAt)))
        if (rows.length === 0) return null
        const sum = rows.reduce((acc, row) => acc + row.rating, 0)
        return Math.round((sum / rows.length) * 100) / 100
      })
    },

    async findByTemplateAndTenant(templateId, tenantId) {
      return withTenantDb(tenantId, async (tdb) => {
        const [row] = await tdb
          .select()
          .from(schema.templateReviews)
          .where(
            and(
              eq(schema.templateReviews.templateId, templateId),
              eq(schema.templateReviews.tenantId, tenantId),
              isNull(schema.templateReviews.deletedAt),
            ),
          )
          .limit(1)
        return row ? toReview(row) : null
      })
    },
  }
}

const clipmartRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: SearchQuery }>('/api/v1/clipmart/templates', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Search templates',
      querystring: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string' },
          markets: { type: 'string' },
          platforms: { type: 'string' },
          official: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { query, category, market, markets, platforms, official, limit, offset } = request.query
    const parsedLimit = parsePaginationParam(limit, 'limit')
    const parsedOffset = parsePaginationParam(offset, 'offset')
    if (parsedLimit === null || parsedOffset === null) {
      return reply.status(400).send({
        type: 'invalid_pagination',
        message: 'limit must be 1-100 and offset must be a non-negative integer',
      })
    }
    return getTemplateService(null).searchTemplates({
      query,
      category,
      targetMarkets: (markets ?? market) ? (markets ?? market)!.split(',') : undefined,
      platforms: platforms ? platforms.split(',') : undefined,
      isOfficial: official !== undefined ? official === 'true' : undefined,
      limit: parsedLimit,
      offset: parsedOffset,
    })
  })

  app.get<{ Params: { id: string } }>('/api/v1/clipmart/templates/:id', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Get template by ID',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      response: { 404: ERROR_SCHEMA },
    },
  }, async (request, reply) => {
    const template = await getTemplateService(null).getTemplate(request.params.id)
    if (!template) {
      return reply.status(404).send({ type: 'not_found', message: 'Template not found' })
    }
    return template
  })

  app.post<{ Body: CreateTemplateBody }>('/api/v1/clipmart/templates', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Create a new template',
      body: {
        type: 'object',
        required: ['name', 'category', 'config'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          targetMarkets: { type: 'array', items: { type: 'string' } },
          targetCategories: { type: 'array', items: { type: 'string' } },
          platforms: { type: 'array', items: { type: 'string' } },
          config: { type: 'object' },
        },
      },
      security: [{ bearerAuth: [] }],
      response: { 400: ERROR_SCHEMA, 403: ERROR_SCHEMA, 422: ERROR_SCHEMA },
    },
  }, async (request, reply) => {
    const auth = extractAuthContext(request)
    if (!auth) {
      return reply.status(400).send({ type: 'auth_required', message: 'valid user or machine auth and matching tenant context required' })
    }
    if (!canWriteClipmart(auth.role)) {
      return reply.status(403).send({ type: 'forbidden', message: 'insufficient role for ClipMart write operation' })
    }

    const validation = validateTemplateConfig(request.body.config)
    if (!validation.valid) {
      const messages = validation.errors
        .filter((e) => e.rule !== 'sensitive_field')
        .map((e) => e.message)
      return reply.status(422).send({
        type: 'security_violation',
        message: messages.join('; '),
      })
    }

    const template = await getTemplateService(auth.tenantId).createTemplate({
      authorTenantId: auth.tenantId,
      name: request.body.name,
      description: request.body.description,
      category: request.body.category,
      targetMarkets: request.body.targetMarkets,
      targetCategories: request.body.targetCategories,
      platforms: request.body.platforms,
      config: validation.sanitizedConfig!,
    })

    await (_clipmartDeps.eventRecorder ?? createDbClipmartEventRecorder()).record({
      tenantId: auth.tenantId,
      eventType: 'clipmart.template_created',
      payload: {
        templateId: template.id,
        category: template.category,
        platforms: template.platforms,
      },
    })

    return reply.status(201).send(template)
  })

  app.post<{ Params: { id: string }; Body: ImportBody }>('/api/v1/clipmart/templates/:id/import', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Import a template into your tenant',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          overrides: { type: 'object' },
        },
      },
      security: [{ bearerAuth: [] }],
      response: { 400: ERROR_SCHEMA, 403: ERROR_SCHEMA, 404: ERROR_SCHEMA, 422: ERROR_SCHEMA },
    },
  }, async (request, reply) => {
    const auth = extractAuthContext(request)
    if (!auth) {
      return reply.status(400).send({ type: 'auth_required', message: 'valid user or machine auth and matching tenant context required' })
    }
    if (!canWriteClipmart(auth.role)) {
      return reply.status(403).send({ type: 'forbidden', message: 'insufficient role for ClipMart write operation' })
    }

    try {
      const result = await getImportService(auth.tenantId).importTemplate(
        auth.tenantId,
        request.params.id,
        request.body?.overrides,
      )
      return result
    } catch (error) {
      if (error instanceof ClipmartError) {
        switch (error.code) {
          case 'TEMPLATE_NOT_FOUND':
            return reply.status(404).send({ type: 'not_found', message: error.message })
          case 'SECURITY_VIOLATION':
            return reply.status(422).send({ type: 'security_violation', message: error.message })
          default:
            return reply.status(500).send({ type: 'import_error', message: error.message })
        }
      }
      const message = error instanceof Error ? error.message : 'Import failed'
      return reply.status(500).send({ type: 'import_error', message })
    }
  })

  app.post<{ Params: { id: string }; Body: ReviewBody }>('/api/v1/clipmart/templates/:id/reviews', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Submit a review for a template',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['rating'],
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string' },
          gmvChange: { type: 'number' },
        },
      },
      security: [{ bearerAuth: [] }],
      response: { 400: ERROR_SCHEMA, 403: ERROR_SCHEMA, 404: ERROR_SCHEMA, 409: ERROR_SCHEMA },
    },
  }, async (request, reply) => {
    const auth = extractAuthContext(request)
    if (!auth) {
      return reply.status(400).send({ type: 'auth_required', message: 'valid user or machine auth and matching tenant context required' })
    }
    if (!canWriteClipmart(auth.role)) {
      return reply.status(403).send({ type: 'forbidden', message: 'insufficient role for ClipMart write operation' })
    }

    try {
      const review = await getReviewService(auth.tenantId).createReview({
        templateId: request.params.id,
        tenantId: auth.tenantId,
        rating: request.body.rating,
        comment: request.body.comment,
        gmvChange: request.body.gmvChange,
      })
      await (_clipmartDeps.eventRecorder ?? createDbClipmartEventRecorder()).record({
        tenantId: auth.tenantId,
        eventType: 'clipmart.review_created',
        payload: {
          templateId: request.params.id,
          rating: review.rating,
          hasComment: typeof review.comment === 'string' && review.comment.length > 0,
        },
      })
      return reply.status(201).send(toPublicReview(review))
    } catch (error) {
      if (error instanceof ClipmartError) {
        switch (error.code) {
          case 'TEMPLATE_NOT_FOUND':
            return reply.status(404).send({ type: 'not_found', message: error.message })
          case 'DUPLICATE_REVIEW':
            return reply.status(409).send({ type: 'duplicate_review', message: error.message })
          case 'INVALID_RATING':
            return reply.status(400).send({ type: 'invalid_rating', message: error.message })
          default:
            return reply.status(400).send({ type: 'review_error', message: error.message })
        }
      }
      const message = error instanceof Error ? error.message : 'Review failed'
      return reply.status(400).send({ type: 'review_error', message })
    }
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>('/api/v1/clipmart/templates/:id/reviews', {
    schema: {
      tags: ['ClipMart'],
      summary: 'Get reviews for a template',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const limit = parsePaginationParam(request.query.limit, 'limit')
    const offset = parsePaginationParam(request.query.offset, 'offset')
    if (limit === null || offset === null) {
      return reply.status(400).send({
        type: 'invalid_pagination',
        message: 'limit must be 1-100 and offset must be a non-negative integer',
      })
    }
    const reviews = await getReviewService(null).getReviews(request.params.id, limit, offset)
    return reviews.map(toPublicReview)
  })
}

export default clipmartRoute
