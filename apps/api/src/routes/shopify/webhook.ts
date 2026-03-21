import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema, getTenantIdByShopDomain } from '@patioer/db'

// --- Event dispatch ---

async function handleOrdersCreate(
  shopDomain: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const tenantId = await getTenantIdByShopDomain('shopify', shopDomain)
  if (!tenantId) {
    console.warn(`[webhook] orders/create: no tenant for shop ${shopDomain}`)
    return
  }

  const orderId = String(payload.id ?? '')
  const status = String(payload.financial_status ?? 'unknown')
  const totalPrice = String(payload.total_price ?? '0')

  await withTenantDb(tenantId, async (db) => {
    await db
      .insert(schema.orders)
      .values({
        tenantId,
        platformOrderId: orderId,
        platform: 'shopify',
        status,
        totalPrice,
        items: (payload.line_items as unknown) ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.orders.tenantId,
          schema.orders.platform,
          schema.orders.platformOrderId,
        ],
        set: { status, totalPrice },
      })
  })
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

    if (typeof shopDomain !== 'string') {
      return reply.code(400).send({ error: 'missing shop domain header' })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' })
    }

    switch (topic) {
      case 'orders/create':
        await handleOrdersCreate(shopDomain, payload)
        break
      default:
        app.log.info({ topic, shopDomain }, 'unhandled Shopify webhook topic')
    }

    return reply.code(200).send({ ok: true })
  })
}

export default shopifyWebhookRoute
