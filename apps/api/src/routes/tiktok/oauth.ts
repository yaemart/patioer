import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { encryptToken } from '../../lib/crypto.js'
import { registry } from '../../lib/harness-registry.js'

const TIKTOK_TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get'
const TIKTOK_AUTH_BASE = 'https://auth.tiktok-shops.com/oauth/authorize'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

interface TikTokTokenResponse {
  access_token: string
  refresh_token: string
  open_id: string
  seller_name: string
  seller_base_region: string
  expire_in: number
}

interface TikTokStatePayload {
  tenantId: string
  appKey: string
  shopId?: string
  nonce: string
  iat: number
}

// --- CSRF state helpers (HMAC-signed, same pattern as shopify/amazon oauth) ---

function signTikTokState(
  payload: Omit<TikTokStatePayload, 'nonce' | 'iat'>,
  secret: string,
): string {
  const full: TikTokStatePayload = {
    ...payload,
    nonce: randomBytes(8).toString('hex'),
    iat: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url')
  const hmac = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${hmac}`
}

function verifyTikTokState(state: string, secret: string): TikTokStatePayload | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TikTokStatePayload
  } catch {
    return null
  }
}

// ---

const tikTokOAuthRoute: FastifyPluginAsync = async (app) => {
  // Step 1 — Redirect merchant to TikTok Shop OAuth consent screen.
  // Required query params: tenantId, appKey
  // Optional query param: shopId (for marketplace sellers)
  app.get('/api/v1/tiktok/auth', async (request, reply) => {
    const appSecret = process.env.TIKTOK_APP_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    const stateSecret = process.env.TIKTOK_STATE_SECRET ?? appSecret
    if (!appSecret || !appBaseUrl || !stateSecret) {
      return reply.code(503).send({ error: 'TikTok OAuth not configured' })
    }

    const query = request.query as Record<string, string>
    const { tenantId, appKey, shopId } = query

    if (!tenantId) return reply.code(400).send({ error: 'tenantId is required' })
    if (!appKey) return reply.code(400).send({ error: 'appKey is required' })

    const state = signTikTokState({ tenantId, appKey, shopId }, stateSecret)
    const redirectUri = `${appBaseUrl}/api/v1/tiktok/auth/callback`

    const authUrl = new URL(TIKTOK_AUTH_BASE)
    authUrl.searchParams.set('app_key', appKey)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('redirect_uri', redirectUri)

    return reply.redirect(authUrl.toString())
  })

  // Step 2 — Exchange authorization code for access_token; persist encrypted token.
  // TikTok callback includes: code, state, shop_id (optional)
  app.get('/api/v1/tiktok/auth/callback', async (request, reply) => {
    const appSecret = process.env.TIKTOK_APP_SECRET
    const encKey = process.env.CRED_ENCRYPTION_KEY
    const appBaseUrl = process.env.APP_BASE_URL
    const stateSecret = process.env.TIKTOK_STATE_SECRET ?? appSecret
    if (!appSecret || !encKey || !appBaseUrl || !stateSecret) {
      return reply.code(503).send({ error: 'TikTok OAuth not configured' })
    }

    const query = request.query as Record<string, string>

    const statePayload = verifyTikTokState(query.state ?? '', stateSecret)
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (Date.now() - statePayload.iat > STATE_MAX_AGE_MS) {
      return reply.code(400).send({ error: 'OAuth state expired' })
    }

    if (typeof query.code !== 'string' || query.code.length === 0) {
      return reply.code(400).send({ error: 'missing authorization code' })
    }

    const { tenantId, appKey, shopId } = statePayload
    const redirectUri = `${appBaseUrl}/api/v1/tiktok/auth/callback`

    let tokenRes: Response
    try {
      // TikTok token endpoint accepts GET with query params
      const tokenUrl = new URL(TIKTOK_TOKEN_URL)
      tokenUrl.searchParams.set('app_key', appKey)
      tokenUrl.searchParams.set('app_secret', appSecret)
      tokenUrl.searchParams.set('auth_code', query.code)
      tokenUrl.searchParams.set('grant_type', 'authorized_code')
      tokenUrl.searchParams.set('redirect_uri', redirectUri)
      tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' })
    } catch (err) {
      app.log.error({ err }, 'TikTok token exchange network error')
      return reply.code(502).send({ error: 'failed to reach TikTok' })
    }

    if (!tokenRes.ok) {
      return reply.code(502).send({ error: 'failed to exchange TikTok OAuth token' })
    }

    let tokenData: { data: TikTokTokenResponse; code: number; message: string }
    try {
      tokenData = (await tokenRes.json()) as { data: TikTokTokenResponse; code: number; message: string }
    } catch {
      return reply.code(502).send({ error: 'invalid token response from TikTok' })
    }

    if (tokenData.code !== 0) {
      app.log.error({ code: tokenData.code, message: tokenData.message }, 'TikTok token exchange failed')
      return reply.code(502).send({ error: 'TikTok token exchange failed' })
    }

    const encryptedToken = encryptToken(tokenData.data.access_token, encKey)
    const resolvedShopId = shopId ?? query.shop_id

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.platformCredentials)
          .values({
            tenantId,
            platform: 'tiktok',
            region: tokenData.data.seller_base_region ?? 'global',
            shopDomain: null,
            accessToken: encryptedToken,
            metadata: {
              appKey,
              // appSecret is intentionally NOT stored in DB — it is read from env at runtime.
              // Storing it in DB would replicate a secret unnecessarily.
              shopId: resolvedShopId,
              sellerName: tokenData.data.seller_name,
            },
          })
          .onConflictDoUpdate({
            target: [
              schema.platformCredentials.tenantId,
              schema.platformCredentials.platform,
              schema.platformCredentials.region,
            ],
            set: {
              accessToken: encryptedToken,
              metadata: { appKey, shopId: resolvedShopId },
            },
          })
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist TikTok OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    registry.invalidate(`${tenantId}:tiktok`)

    return reply.send({ ok: true })
  })
}

export default tikTokOAuthRoute
