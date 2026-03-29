import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb } from '@patioer/db'
import { extractJwtToken, verifyJwt } from '../routes/auth.js'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PUBLIC_ROUTE_KEYS = new Set([
  'GET /api/v1/health',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/onboarding/register',
  'GET /api/v1/tenants/resolve',
  'POST /api/v1/webhooks/stripe',
  'POST /api/v1/webhooks/shopify',
  'POST /api/v1/webhooks/amazon',
  'POST /api/v1/webhooks/tiktok',
  'POST /api/v1/webhooks/shopee',
  'POST /api/v1/webhooks/walmart',
  'POST /api/v1/agents/:id/execute',
  'GET /api/v1/clipmart/templates',
  'GET /api/v1/clipmart/templates/:id',
  'GET /api/v1/clipmart/templates/:id/reviews',
])

function isPublicRoute(
  request: { method: string; routeOptions?: { url?: string }; raw: { url?: string } },
): boolean {
  const matchedUrl = request.routeOptions?.url
  const rawUrl = request.raw.url?.split('?')[0] ?? ''
  const routeKey = matchedUrl ? `${request.method} ${matchedUrl}` : null
  return matchedUrl === undefined || (routeKey !== null && PUBLIC_ROUTE_KEYS.has(routeKey)) || rawUrl.startsWith('/api/v1/docs')
}

const tenantPlugin: FastifyPluginAsync = async (app) => {
  // Declare the per-request slot so Fastify can track it properly.
  app.decorateRequest('withDb', null)
  app.decorateRequest('auth', null)

  app.addHook('preHandler', async (request, reply) => {
    const headerTenantId = request.headers['x-tenant-id']

    if (headerTenantId !== undefined && typeof headerTenantId !== 'string') {
      await reply.code(400).send({ error: 'x-tenant-id must be a single UUID string' })
      return
    }

    if (typeof headerTenantId === 'string' && headerTenantId.length > 0 && !UUID_REGEX.test(headerTenantId)) {
      await reply.code(400).send({ error: 'x-tenant-id must be a valid UUID' })
      return
    }

    const token = extractJwtToken(request.headers)
    const publicRoute = isPublicRoute(request)

    if (!token) {
      if (!publicRoute) {
        await reply.code(401).send({ error: 'JWT authentication required' })
        return
      }
      if (typeof headerTenantId !== 'string' || headerTenantId.length === 0) {
        return
      }
      request.tenantId = headerTenantId
      request.withDb = (cb) => withTenantDb(headerTenantId, cb)
      return
    }

    const payload = verifyJwt(token)
    if (!payload || !UUID_REGEX.test(payload.tenantId)) {
      await reply.code(401).send({ error: 'Invalid or expired JWT' })
      return
    }

    if (typeof headerTenantId === 'string' && headerTenantId.length > 0 && headerTenantId !== payload.tenantId) {
      await reply.code(401).send({ error: 'JWT tenant does not match x-tenant-id' })
      return
    }

    request.auth = payload
    request.tenantId = payload.tenantId
    // Bind a convenience helper so route handlers never touch the global db.
    // Calling request.withDb(cb) opens a transaction, runs SET LOCAL
    // app.tenant_id, executes cb, then commits — fully RLS-enforced.
    request.withDb = (cb) => withTenantDb(payload.tenantId, cb)
  })
}

export default fp(tenantPlugin)
