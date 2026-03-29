import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- shop_id lookup must resolve tenant across all credentials before entering tenant-scoped flow
import { db, schema } from '@patioer/db'
import { handleShopeeWebhook, type ShopeeTopic } from '../../lib/webhook-topic-handler.js'

/** Maps Shopee push-notification numeric codes to canonical topic strings. */
const SHOPEE_CODE_TO_TOPIC: Record<number, ShopeeTopic> = {
  3: 'shopee:order.status_update',
  6: 'shopee:logistics.tracking_update',
  1: 'shopee:shop.update_profile',
}

/**
 * Shopee push notification signature:
 * HMAC-SHA256(partnerKey, partnerId + url + body) as lowercase hex
 */
export function verifyShopeeWebhookSignature(
  partnerKey: string,
  partnerId: number,
  url: string,
  rawBody: Buffer,
): string {
  const base = `${partnerId}${url}${rawBody.toString('utf8')}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

export async function resolveShopeeTenantIdByShopId(shopId: number): Promise<string | null> {
  const rows = await db
    .select({
      tenantId: schema.platformCredentials.tenantId,
      metadata: schema.platformCredentials.metadata,
    })
    .from(schema.platformCredentials)
    .where(eq(schema.platformCredentials.platform, 'shopee'))

  const matchingTenantIds = rows
    .filter((row) => {
      const metadata = row.metadata
      return Boolean(
        metadata
        && typeof metadata === 'object'
        && !Array.isArray(metadata)
        && metadata['shopId'] === shopId,
      )
    })
    .map((row) => row.tenantId)

  const uniqueTenantIds = Array.from(new Set(matchingTenantIds))
  if (uniqueTenantIds.length !== 1) {
    return null
  }

  return uniqueTenantIds[0]
}

const shopeeWebhookRoute: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  // POST /api/v1/webhooks/shopee
  app.post('/api/v1/webhooks/shopee', async (request, reply) => {
    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
    if (!partnerKey || !partnerId) {
      return reply.code(503).send({ error: 'Shopee webhook not configured' })
    }

    const rawBody = request.body as Buffer
    const providedSign = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
    const fullUrl = request.url

    const expectedSign = verifyShopeeWebhookSignature(partnerKey, partnerId, fullUrl, rawBody)
    if (!timingSafeEqualHex(providedSign, expectedSign)) {
      return reply.code(401).send({ error: 'invalid signature' })
    }

    let payload: { code?: number; data?: unknown; shop_id?: number }
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    app.log.info({ eventCode: payload.code, shopId: payload.shop_id }, 'shopee webhook received')

    if (typeof payload.shop_id !== 'number' || !Number.isFinite(payload.shop_id)) {
      return reply.code(400).send({ error: 'shop_id required' })
    }

    const tenantId = await resolveShopeeTenantIdByShopId(payload.shop_id)
    if (!tenantId) {
      return reply.code(404).send({ error: 'tenant not found for shopee shop' })
    }

    // Dispatch to registered handler (best-effort; no throw on missing handler)
    const shopeeTopic: ShopeeTopic =
      SHOPEE_CODE_TO_TOPIC[payload.code ?? -1] ?? 'shopee:order.status_update'
    await handleShopeeWebhook(tenantId, shopeeTopic, payload)

    return reply.code(200).send({ ok: true })
  })
}

export default shopeeWebhookRoute
