import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { eq, and } from 'drizzle-orm'

// --- Event dispatch ---

async function handleOrdersCreate(
  shopDomain: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Resolve tenant from shop domain, then upsert order into DB
  const tenantRow = await findTenantByShopDomain(shopDomain)
  if (!tenantRow) {
    console.warn(`[webhook] orders/create: no tenant for shop ${shopDomain}`)
    return
  }

  const orderId = String(payload.id ?? '')
  const status = String(payload.financial_status ?? 'unknown')
  const totalPrice = String(payload.total_price ?? '0')

  await withTenantDb(tenantRow.tenantId, async (db) => {
    await db
      .insert(schema.orders)
      .values({
        tenantId: tenantRow.tenantId,
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

async function findTenantByShopDomain(
  shopDomain: string,
): Promise<{ tenantId: string } | null> {
  const { db } = await import('@patioer/db')
  const [row] = await db
    .select({ tenantId: schema.platformCredentials.tenantId })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.platform, 'shopify'),
        eq(schema.platformCredentials.shopDomain, shopDomain),
      ),
    )
    .limit(1)
  return row ?? null
}

// --- Route ---

const shopifyWebhookRoute: FastifyPluginAsync = async (app) => {
  // Parse the body as a raw Buffer so we can verify Shopify's HMAC signature.
  // This parser is scoped to this plugin and does not affect other routes.
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

    // Dispatch by topic — extend this switch as new event types are needed
    switch (topic) {
      case 'orders/create':
        await handleOrdersCreate(shopDomain, payload)
        break
      default:
        // Acknowledge unrecognised topics so Shopify doesn't retry indefinitely
        app.log.info({ topic, shopDomain }, 'unhandled Shopify webhook topic')
    }

    return reply.code(200).send({ ok: true })
  })
}

export default shopifyWebhookRoute
