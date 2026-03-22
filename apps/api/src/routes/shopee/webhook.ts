import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'

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

    return reply.code(200).send({ ok: true })
  })
}

export default shopeeWebhookRoute
