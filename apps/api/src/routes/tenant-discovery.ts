import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { getTenantPublicBySlug } from '@patioer/db'
import { z } from 'zod'

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)

const querySchema = z.object({
  slug: slugSchema,
})

type RateLimitWindow = {
  count: number
  windowStartMs: number
}

const rateLimitState = new Map<string, RateLimitWindow>()

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const safeCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

const tenantDiscoveryRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/tenants/resolve', async (request, reply) => {
    const configuredApiKey = process.env.TENANT_DISCOVERY_API_KEY
    if (!configuredApiKey) {
      await reply.code(503).send({ error: 'tenant discovery is disabled' })
      return
    }

    const presentedApiKey = request.headers['x-discovery-key']
    if (typeof presentedApiKey !== 'string' || !safeCompare(presentedApiKey, configuredApiKey)) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }

    const rateLimitMaxRequests = parsePositiveInt(
      process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX,
      60,
    )
    const rateLimitWindowMs = parsePositiveInt(
      process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS,
      60_000,
    )
    const key = `${request.ip}:${presentedApiKey}`
    const now = Date.now()
    const state = rateLimitState.get(key)

    if (!state || now - state.windowStartMs >= rateLimitWindowMs) {
      rateLimitState.set(key, { count: 1, windowStartMs: now })
    } else {
      state.count += 1
      if (state.count > rateLimitMaxRequests) {
        const retryAfter = Math.ceil((rateLimitWindowMs - (now - state.windowStartMs)) / 1000)
        await reply
          .header('retry-after', retryAfter.toString())
          .code(429)
          .send({ error: 'rate limit exceeded' })
        return
      }
    }

    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      await reply.code(400).send({ error: 'invalid slug' })
      return
    }

    const tenant = await getTenantPublicBySlug(parsed.data.slug)
    if (!tenant) {
      await reply.code(404).send({ error: 'resource not found' })
      return
    }

    await reply.send({ tenant })
  })
}

export default tenantDiscoveryRoute
