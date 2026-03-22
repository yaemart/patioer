import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { encryptToken } from '../../lib/crypto.js'
import { registry } from '../../lib/harness-registry.js'

// Shopee OAuth code flow:
//   1. Auth redirect signature: HMAC-SHA256(partnerKey, partnerId + path + timestamp) — no access_token/shop_id
//   2. Same partner credentials across markets; shop authorisation yields shopId + access_token

const SHOPEE_AUTH_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner'
const SHOPEE_TOKEN_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/auth/token/get'

export function buildShopeeAuthSign(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
): string {
  return crypto.createHmac('sha256', partnerKey).update(`${partnerId}${path}${timestamp}`).digest('hex')
}

const shopeeOAuthRoute: FastifyPluginAsync = async (app) => {
  app.get('/auth', async (request, reply) => {
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const appBaseUrl = process.env.APP_BASE_URL
    if (!partnerId || !partnerKey || !appBaseUrl) {
      return reply.code(503).send({ error: 'Shopee OAuth not configured' })
    }

    const query = request.query as Record<string, string>
    const { tenantId, market } = query
    if (!tenantId) return reply.code(400).send({ error: 'tenantId required' })
    if (!market) return reply.code(400).send({ error: 'market required (SG/MY/TH/PH/ID/VN)' })

    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/api/v2/shop/auth_partner'
    const sign = buildShopeeAuthSign(partnerKey, partnerId, path, timestamp)

    const redirectUrl = `${appBaseUrl}/api/v1/shopee/auth/callback`
    const state = Buffer.from(JSON.stringify({ tenantId, market })).toString('base64url')

    const url = new URL(SHOPEE_AUTH_URL)
    url.searchParams.set('partner_id', String(partnerId))
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', sign)
    url.searchParams.set('redirect', redirectUrl)
    url.searchParams.set('state', state)

    return reply.redirect(url.toString())
  })

  app.get('/auth/callback', async (request, reply) => {
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const encKey = process.env.CRED_ENCRYPTION_KEY ?? process.env.SHOPIFY_ENCRYPTION_KEY
    if (!partnerId || !partnerKey || !encKey) {
      return reply.code(503).send({ error: 'Shopee OAuth not configured' })
    }

    const q = request.query as Record<string, string>
    const { code, shop_id: shopIdRaw, state } = q
    if (!code || !shopIdRaw || !state) {
      return reply.code(400).send({ error: 'code, shop_id and state required' })
    }

    let tenantId: string
    let market: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Record<string, string>
      tenantId = decoded.tenantId
      market = decoded.market
    } catch {
      return reply.code(400).send({ error: 'invalid state' })
    }

    let tokenRes: Response
    try {
      tokenRes = await fetch(SHOPEE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          shop_id: Number(shopIdRaw),
          partner_id: partnerId,
        }),
      })
    } catch (err) {
      app.log.error({ err }, 'Shopee token exchange network error')
      return reply.code(502).send({ error: 'failed to reach Shopee' })
    }

    if (!tokenRes.ok) {
      return reply.code(502).send({ error: 'token exchange failed' })
    }

    let tokenData: { access_token?: string; refresh_token?: string }
    try {
      tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string }
    } catch {
      return reply.code(502).send({ error: 'invalid token response from Shopee' })
    }

    if (!tokenData.access_token) {
      return reply.code(502).send({ error: 'no access_token' })
    }

    const encryptedToken = encryptToken(tokenData.access_token, encKey)
    const shopIdNum = Number(shopIdRaw)

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.platformCredentials)
          .values({
            tenantId,
            platform: 'shopee',
            credentialType: 'hmac',
            accessToken: encryptedToken,
            region: market,
            metadata: { partnerId, shopId: shopIdNum },
          })
          .onConflictDoUpdate({
            target: [
              schema.platformCredentials.tenantId,
              schema.platformCredentials.platform,
              schema.platformCredentials.region,
            ],
            set: {
              accessToken: encryptedToken,
              metadata: { partnerId, shopId: shopIdNum },
            },
          })
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Shopee OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    registry.invalidate(`${tenantId}:shopee`)

    return reply.send({ ok: true, shopId: shopIdRaw, market })
  })
}

export default shopeeOAuthRoute
