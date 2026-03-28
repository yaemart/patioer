import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface BucketEntry {
  count: number
  resetAt: number
}

interface RateLimitOpts {
  /** Max requests per window. Default 200 */
  max?: number
  /** Window length in ms. Default 60_000 (1 min) */
  windowMs?: number
}

/**
 * Simple in-memory per-tenant sliding-window rate limiter.
 * Uses X-Tenant-Id header as the bucket key (falls back to remote IP).
 * Not suited for multi-instance deployments; swap to Redis if needed.
 */
export function registerRateLimit(app: FastifyInstance, opts?: RateLimitOpts): void {
  const max = opts?.max ?? 200
  const windowMs = opts?.windowMs ?? 60_000

  const buckets = new Map<string, BucketEntry>()

  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key)
    }
  }, windowMs).unref()

  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    if (request.url === '/health' || request.url === '/metrics') {
      done()
      return
    }

    const key =
      (typeof request.headers['x-tenant-id'] === 'string' ? request.headers['x-tenant-id'] : null)
      ?? request.ip
      ?? 'unknown'

    const now = Date.now()
    let entry = buckets.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      buckets.set(key, entry)
    }

    entry.count++

    void reply.header('X-RateLimit-Limit', max)
    void reply.header('X-RateLimit-Remaining', Math.max(0, max - entry.count))
    void reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000))

    if (entry.count > max) {
      void reply.code(429).send({ error: 'rate limit exceeded', retryAfterMs: entry.resetAt - now })
      return
    }

    done()
  })
}
