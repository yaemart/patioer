import { createHmac, timingSafeEqual } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'

/** TikTok live-commerce order stream — higher priority for downstream workers / replay. */
export const TIKTOK_WEBHOOK_TOPIC_LIVE_ORDER = 'LIVE_ORDER' as const

/**
 * Verifies the HMAC-SHA256 signature TikTok appends to every webhook notification.
 *
 * Signature string: HMAC-SHA256(appSecret, timestamp + nonce + rawBody)
 * TikTok sends the digest as a Base64-encoded string in the `Authorization` header.
 */
export function verifyTikTokWebhookSignature(
  appSecret: string,
  signature: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer | string,
): boolean {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const expected = createHmac('sha256', appSecret)
    .update(`${timestamp}${nonce}${body}`)
    .digest('base64')

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

const tikTokWebhookRoute: FastifyPluginAsync = async (app) => {
  // Capture raw body bytes for HMAC verification before any parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  /**
   * POST /api/v1/webhooks/tiktok
   *
   * Headers expected:
   *   x-tenant-id      — identifies the tenant
   *   Authorization    — HMAC-SHA256 Base64 signature from TikTok
   *   x-timestamp      — Unix timestamp (string) sent by TikTok
   *   x-nonce          — Random nonce sent by TikTok
   */
  app.post('/api/v1/webhooks/tiktok', async (request, reply) => {
    const appSecret = process.env.TIKTOK_APP_SECRET
    if (!appSecret) {
      return reply.code(503).send({ error: 'TikTok webhook not configured' })
    }

    const headers = request.headers as Record<string, string>
    const tenantId = headers['x-tenant-id']
    if (!tenantId) {
      return reply.code(400).send({ error: 'x-tenant-id header is required' })
    }

    const signature = headers['authorization'] ?? ''
    const timestamp = headers['x-timestamp'] ?? ''
    const nonce = headers['x-nonce'] ?? ''
    const rawBody = request.body as Buffer

    if (!verifyTikTokWebhookSignature(appSecret, signature, timestamp, nonce, rawBody)) {
      return reply.code(401).send({ error: 'invalid webhook signature' })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    const topic = typeof payload['type'] === 'string' ? payload['type'] : 'unknown'
    const messageId = typeof payload['message_id'] === 'string' ? payload['message_id'] : randomUUID()
    const isLiveOrder = topic === TIKTOK_WEBHOOK_TOPIC_LIVE_ORDER
    /** Distinguish live orders from standard `ORDER_STATUS_CHANGE` for workers & replay (see webhook-replay). */
    const rowStatus = isLiveOrder ? 'received_live' : 'received'

    if (isLiveOrder) {
      app.log.info({ tenantId, messageId, topic }, 'TikTok LIVE_ORDER webhook — persisted with status received_live')
    }

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.webhookEvents)
          .values({
            tenantId,
            platform: 'tiktok',
            webhookId: messageId,
            topic,
            shopDomain: null,
            payload,
            status: rowStatus,
          })
          .onConflictDoNothing()
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist TikTok webhook event')
      return reply.code(500).send({ error: 'failed to persist webhook' })
    }

    return reply.code(200).send({ ok: true })
  })
}

export default tikTokWebhookRoute
