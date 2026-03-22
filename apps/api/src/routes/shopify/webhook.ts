import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, getTenantIdByShopDomain } from '@patioer/db'
import {
  recordWebhookIfNew,
  markWebhookProcessed,
  markWebhookFailed,
} from '../../lib/webhook-dedup.js'
import { handleWebhookTopic } from '../../lib/webhook-topic-handler.js'

// Known topics that have a handler in webhook-topic-handler.ts.
// Kept in sync so the webhook route can distinguish "unhandled" from "handled".
const HANDLED_TOPICS = new Set([
  'orders/create',
  'orders/updated',
  'products/create',
  'products/update',
])

// Returns true when the topic was dispatched to a handler, false when unrecognised.
async function dispatchWebhook(
  topic: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!HANDLED_TOPICS.has(topic)) return false
  await handleWebhookTopic(topic, tenantId, payload)
  return true
}

// --- Route ---
// IMPORTANT: Do NOT wrap this plugin with fastify-plugin (fp). The custom
// content-type parser below is intentionally scoped to this encapsulated
// plugin context so it does not override the default JSON parser globally.

const shopifyWebhookRoute: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  app.post('/api/v1/webhooks/shopify', async (request, reply) => {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET
    if (!secret) {
      return reply.code(503).send({ error: 'webhook not configured' })
    }

    const rawBody = request.body as Buffer
    const hmacHeader = request.headers['x-shopify-hmac-sha256']
    if (typeof hmacHeader !== 'string') {
      return reply.code(401).send({ error: 'missing HMAC header' })
    }

    const computed = createHmac('sha256', secret).update(rawBody).digest('base64')
    const computedBuf = Buffer.from(computed, 'base64')
    const hmacBuf = Buffer.from(hmacHeader, 'base64')

    if (computedBuf.length !== hmacBuf.length || !timingSafeEqual(computedBuf, hmacBuf)) {
      return reply.code(401).send({ error: 'invalid HMAC' })
    }

    const topic = request.headers['x-shopify-topic']
    const shopDomain = request.headers['x-shopify-shop-domain']
    const webhookId = request.headers['x-shopify-webhook-id']

    if (typeof shopDomain !== 'string') {
      return reply.code(400).send({ error: 'missing shop domain header' })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    const topicStr = typeof topic === 'string' ? topic : 'unknown'
    const webhookIdStr = typeof webhookId === 'string' ? webhookId : `${shopDomain}:${topicStr}:${Date.now()}`

    const tenantId = await getTenantIdByShopDomain('shopify', shopDomain)
    if (tenantId && webhookIdStr) {
      // Wrap in try-catch: although recordWebhookIfNew is now atomic (ON CONFLICT
      // DO NOTHING), unexpected DB errors (connection loss, etc.) must not surface
      // as 500s to Shopify — Shopify retries on any non-2xx, so we return 200 and
      // log the failure for ops investigation.
      let dedupResult: { duplicate: boolean; eventId?: string }
      try {
        dedupResult = await withTenantDb(tenantId, (db) =>
          recordWebhookIfNew(db, { webhookId: webhookIdStr, topic: topicStr, shopDomain, tenantId }, payload),
        )
      } catch (err) {
        app.log.warn({ err, webhookId: webhookIdStr }, 'webhook dedup failed — skipping to avoid double-processing')
        return reply.code(200).send({ ok: true })
      }

      const { duplicate, eventId } = dedupResult

      if (duplicate) {
        app.log.info({ webhookId: webhookIdStr }, 'duplicate webhook, skipping')
        return reply.code(200).send({ ok: true, duplicate: true })
      }

      if (eventId) {
        let handled: boolean
        try {
          handled = await dispatchWebhook(topicStr, tenantId, payload)
          if (!handled) {
            app.log.warn(
              { topic: topicStr, webhookId: webhookIdStr, shopDomain },
              'unhandled webhook topic — marking processed to prevent replay accumulation',
            )
          }
        } catch (err) {
          await withTenantDb(tenantId, (db) =>
            markWebhookFailed(db, eventId, err instanceof Error ? err.message : String(err)),
          )
          app.log.error({ err, webhookId: webhookIdStr }, 'webhook processing failed')
          return reply.code(200).send({ ok: true })
        }

        try {
          await withTenantDb(tenantId, (db) => markWebhookProcessed(db, eventId))
        } catch (err) {
          app.log.error(
            { err, webhookId: webhookIdStr, handled, topic: topicStr },
            'webhook handled but failed to mark processed; leaving as received for retry',
          )
        }
      }
    } else {
      app.log.info({ topic: topicStr, shopDomain }, 'unhandled Shopify webhook topic')
    }

    return reply.code(200).send({ ok: true })
  })
}

export default shopifyWebhookRoute
