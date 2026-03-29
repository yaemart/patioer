import crypto from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { encryptToken } from '../../lib/crypto.js'
import { persistOAuthCredential } from '../../lib/oauth-credential-store.js'
import { isOAuthStateFresh, signOAuthState, verifyOAuthState } from '../../lib/oauth-state.js'

// Shopee OAuth code flow:
//   1. Auth redirect signature: HMAC-SHA256(partnerKey, partnerId + path + timestamp) — no access_token/shop_id
//   2. Same partner credentials across markets; shop authorisation yields shopId + access_token

const SHOPEE_AUTH_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner'
const SHOPEE_TOKEN_URL = 'https://partner.test-stable.shopeemobile.com/api/v2/auth/token/get'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

interface ShopeeStatePayload {
  tenantId: string
  market: string
  nonce: string
  iat: number
}

export function buildShopeeAuthSign(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
): string {
  return crypto.createHmac('sha256', partnerKey).update(`${partnerId}${path}${timestamp}`).digest('hex')
}

const shopeeOAuthRoute: FastifyPluginAsync = async (app) => {
  app.get('/auth', {
    schema: {
      tags: ['Shopee OAuth'],
      summary: 'Start Shopee OAuth for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const appBaseUrl = process.env.APP_BASE_URL
    const stateSecret = process.env.SHOPEE_STATE_SECRET ?? partnerKey
    if (!partnerId || !partnerKey || !appBaseUrl || !stateSecret) {
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
    const state = signOAuthState({ tenantId, market }, stateSecret)

    const url = new URL(SHOPEE_AUTH_URL)
    url.searchParams.set('partner_id', String(partnerId))
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', sign)
    url.searchParams.set('redirect', redirectUrl)
    url.searchParams.set('state', state)

    return reply.redirect(url.toString())
  })

  app.get('/auth/callback', {
    schema: {
      tags: ['Shopee OAuth'],
      summary: 'Complete Shopee OAuth callback for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID ?? 0)
    const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? ''
    const encKey = process.env.CRED_ENCRYPTION_KEY ?? process.env.SHOPIFY_ENCRYPTION_KEY
    const stateSecret = process.env.SHOPEE_STATE_SECRET ?? partnerKey
    if (!partnerId || !partnerKey || !encKey || !stateSecret) {
      return reply.code(503).send({ error: 'Shopee OAuth not configured' })
    }

    const q = request.query as Record<string, string>
    const { code, shop_id: shopIdRaw, state } = q
    if (!code || !shopIdRaw || !state) {
      return reply.code(400).send({ error: 'code, shop_id and state required' })
    }

    const statePayload = verifyOAuthState<ShopeeStatePayload>(state, stateSecret)
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (!isOAuthStateFresh(statePayload, STATE_MAX_AGE_MS)) {
      return reply.code(400).send({ error: 'OAuth state expired' })
    }

    const { tenantId, market } = statePayload

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
      await persistOAuthCredential({
        tenantId,
        platform: 'shopee',
        credentialType: 'hmac',
        region: market,
        accessToken: encryptedToken,
        metadata: { partnerId, shopId: shopIdNum },
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Shopee OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    return reply.send({ ok: true, shopId: shopIdRaw, market })
  })
}

export default shopeeOAuthRoute
