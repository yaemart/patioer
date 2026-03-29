import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { handleWalmartWebhook, type WalmartTopic } from '../../lib/webhook-topic-handler.js'

const MAX_REPLAY_WINDOW_MS = 5 * 60 * 1000
const ALLOWED_CLOCK_SKEW_MS = 2 * 60 * 1000
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WalmartWebhookSource {
  eventId?: string
  eventType?: string
  eventTime?: string
}

interface WalmartWebhookNotificationPayload {
  notificationType?: string
  partnerId?: string
}

interface WalmartWebhookPayload {
  source?: WalmartWebhookSource
  payload?: WalmartWebhookNotificationPayload & Record<string, unknown>
  eventType?: string
  resourceName?: string
  eventId?: string
  timestamp?: string
}

function sha256Hex(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex')
}

export function verifyWalmartWebhookSignature(input: {
  method: string
  pathAndQuery: string
  timestamp: string
  rawBody: Buffer
  providedSignature: string
  secret: string
}): boolean {
  const toSign = [
    input.method.toUpperCase(),
    input.pathAndQuery,
    input.timestamp,
    sha256Hex(input.rawBody),
  ].join('\n')
  const expected = createHmac('sha256', input.secret).update(toSign, 'utf8').digest('base64')
  const providedBuf = Buffer.from(input.providedSignature, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}

function isFreshTimestamp(timestamp: string): boolean {
  const epochSeconds = Number(timestamp)
  if (!Number.isFinite(epochSeconds)) return false
  const ageMs = Date.now() - epochSeconds * 1000
  if (ageMs < -ALLOWED_CLOCK_SKEW_MS) return false
  return ageMs <= MAX_REPLAY_WINDOW_MS + ALLOWED_CLOCK_SKEW_MS
}

function extractTenantId(url: string | undefined): string | null {
  if (!url) return null
  const query = url.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const tenantId = params.get('tenantId')
  return tenantId && UUID_REGEX.test(tenantId) ? tenantId : null
}

function extractEventId(payload: WalmartWebhookPayload, rawBody: Buffer): string {
  const candidate = payload.source?.eventId ?? payload.eventId
  if (candidate && candidate.length > 0) return candidate
  return `walmart:${sha256Hex(rawBody)}`
}

function extractTopic(payload: WalmartWebhookPayload): WalmartTopic {
  const notificationType = payload.payload?.notificationType
  const eventType = payload.source?.eventType ?? payload.eventType ?? payload.resourceName ?? 'unknown'
  return `walmart:${notificationType ?? eventType}`
}

const walmartWebhookRoute: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  app.post('/api/v1/webhooks/walmart', async (request, reply) => {
    const secret = process.env.WALMART_WEBHOOK_SECRET
    if (!secret) {
      return reply.code(503).send({ error: 'Walmart webhook not configured' })
    }

    const rawBody = request.body as Buffer
    const providedSignature = request.headers['wm_sec.signature']
    const timestamp = request.headers['wm_sec.timestamp']
    if (typeof providedSignature !== 'string' || typeof timestamp !== 'string') {
      return reply.code(401).send({ error: 'missing Walmart signature headers' })
    }
    if (!isFreshTimestamp(timestamp)) {
      return reply.code(401).send({ error: 'expired Walmart webhook timestamp' })
    }
    if (!verifyWalmartWebhookSignature({
      method: request.method,
      pathAndQuery: request.raw.url ?? request.url,
      timestamp,
      rawBody,
      providedSignature,
      secret,
    })) {
      return reply.code(401).send({ error: 'invalid Walmart webhook signature' })
    }

    let body: WalmartWebhookPayload
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WalmartWebhookPayload
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    const tenantId = extractTenantId(request.raw.url)
    if (!tenantId) {
      return reply.code(400).send({ error: 'tenantId query parameter is required' })
    }

    const eventId = extractEventId(body, rawBody)
    const walmartTopic = extractTopic(body)

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.webhookEvents)
          .values({
            tenantId,
            platform: 'walmart',
            webhookId: eventId,
            topic: walmartTopic,
            shopDomain: null,
            payload: body as unknown as Record<string, unknown>,
            status: 'received',
          })
          .onConflictDoNothing()
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Walmart webhook event')
      return reply.code(500).send({ error: 'failed to persist notification' })
    }

    await handleWalmartWebhook(tenantId, walmartTopic, body)

    return reply.code(200).send({ ok: true })
  })
}

export default walmartWebhookRoute
