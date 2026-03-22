import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { withTenantDb, schema } from '@patioer/db'
import { encryptToken } from '../../lib/crypto.js'
import { registry } from '../../lib/harness-registry.js'

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const LWA_AUTH_BASE = 'https://sellercentral.amazon.com/apps/authorize/consent'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

interface LwaTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

interface AmazonStatePayload {
  tenantId: string
  sellerId: string
  marketplaceId: string
  region: string
  nonce: string
  iat: number
}

// --- CSRF state helpers (same sign/verify pattern as shopify/oauth.ts) ---

function signAmazonState(
  payload: Omit<AmazonStatePayload, 'nonce' | 'iat'>,
  secret: string,
): string {
  const full: AmazonStatePayload = {
    ...payload,
    nonce: randomBytes(8).toString('hex'),
    iat: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url')
  const hmac = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${hmac}`
}

function verifyAmazonState(state: string, secret: string): AmazonStatePayload | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AmazonStatePayload
  } catch {
    return null
  }
}

// ---

const amazonOAuthRoute: FastifyPluginAsync = async (app) => {
  // Step 1 — Redirect merchant to Amazon LWA consent screen.
  // Required query params: tenantId, sellerId, marketplaceId
  // Optional query param: region (na|eu|fe, defaults to 'na')
  app.get('/api/v1/amazon/auth', async (request, reply) => {
    const clientId = process.env.AMAZON_CLIENT_ID
    const clientSecret = process.env.AMAZON_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    // AMAZON_STATE_SECRET is the dedicated CSRF signing key.
    // Falls back to clientSecret for backward compatibility but the dedicated
    // key is strongly preferred: rotation does not require Amazon app re-consent.
    const stateSecret = process.env.AMAZON_STATE_SECRET ?? clientSecret
    if (!clientId || !clientSecret || !appBaseUrl || !stateSecret) {
      return reply.code(503).send({ error: 'Amazon OAuth not configured' })
    }

    const query = request.query as Record<string, string>
    const { tenantId, sellerId, marketplaceId, region = 'na' } = query

    if (!tenantId) return reply.code(400).send({ error: 'tenantId is required' })
    if (!sellerId) return reply.code(400).send({ error: 'sellerId is required' })
    if (!marketplaceId) return reply.code(400).send({ error: 'marketplaceId is required' })

    const state = signAmazonState({ tenantId, sellerId, marketplaceId, region }, stateSecret)
    const redirectUri = `${appBaseUrl}/api/v1/amazon/auth/callback`

    const authUrl = new URL(LWA_AUTH_BASE)
    authUrl.searchParams.set('application_id', clientId)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('version', 'beta')

    return reply.redirect(authUrl.toString())
  })

  // Step 2 — Exchange authorization code for tokens; persist encrypted refresh_token.
  // Amazon callback includes: code, state, selling_partner_id
  app.get('/api/v1/amazon/auth/callback', async (request, reply) => {
    const clientId = process.env.AMAZON_CLIENT_ID
    const clientSecret = process.env.AMAZON_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    const encKey = process.env.CRED_ENCRYPTION_KEY
    const stateSecret = process.env.AMAZON_STATE_SECRET ?? clientSecret
    if (!clientId || !clientSecret || !appBaseUrl || !encKey || !stateSecret) {
      return reply.code(503).send({ error: 'Amazon OAuth not configured' })
    }

    const query = request.query as Record<string, string>

    const statePayload = verifyAmazonState(query.state ?? '', stateSecret)
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (Date.now() - statePayload.iat > STATE_MAX_AGE_MS) {
      return reply.code(400).send({ error: 'OAuth state expired' })
    }

    if (typeof query.code !== 'string' || query.code.length === 0) {
      return reply.code(400).send({ error: 'missing authorization code' })
    }

    const redirectUri = `${appBaseUrl}/api/v1/amazon/auth/callback`
    let tokenRes: Response
    try {
      tokenRes = await fetch(LWA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })
    } catch (err) {
      app.log.error({ err }, 'Amazon LWA token exchange network error')
      return reply.code(502).send({ error: 'failed to reach Amazon LWA' })
    }

    if (!tokenRes.ok) {
      return reply.code(502).send({ error: 'failed to exchange Amazon OAuth token' })
    }

    let tokenData: LwaTokenResponse
    try {
      tokenData = (await tokenRes.json()) as LwaTokenResponse
    } catch {
      return reply.code(502).send({ error: 'invalid token response from Amazon' })
    }

    const encryptedRefreshToken = encryptToken(tokenData.refresh_token, encKey)
    const { tenantId, sellerId, marketplaceId, region } = statePayload

    try {
      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.platformCredentials)
          .values({
            tenantId,
            platform: 'amazon',
            credentialType: 'lwa',
            region,
            shopDomain: null,
            accessToken: encryptedRefreshToken,
            metadata: {
              clientId,
              sellerId,
              marketplaceId,
            },
          })
          .onConflictDoUpdate({
            target: [
              schema.platformCredentials.tenantId,
              schema.platformCredentials.platform,
              schema.platformCredentials.region,
            ],
            set: {
              accessToken: encryptedRefreshToken,
              metadata: { clientId, sellerId, marketplaceId },
            },
          })
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Amazon OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    registry.invalidate(`${tenantId}:amazon`)

    return reply.send({ ok: true })
  })
}

export default amazonOAuthRoute
