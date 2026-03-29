import type { FastifyPluginAsync } from 'fastify'
import { encryptToken } from '../../lib/crypto.js'
import { persistOAuthCredential } from '../../lib/oauth-credential-store.js'
import { isOAuthStateFresh, signOAuthState, verifyOAuthState } from '../../lib/oauth-state.js'

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

const amazonOAuthRoute: FastifyPluginAsync = async (app) => {
  // Step 1 — Redirect merchant to Amazon LWA consent screen.
  // Required query params: tenantId, sellerId, marketplaceId
  // Optional query param: region (na|eu|fe, defaults to 'na')
  app.get('/api/v1/amazon/auth', {
    schema: {
      tags: ['Amazon OAuth'],
      summary: 'Start Amazon OAuth for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
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

    const state = signOAuthState(
      { tenantId, sellerId, marketplaceId, region },
      stateSecret,
    )
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
  app.get('/api/v1/amazon/auth/callback', {
    schema: {
      tags: ['Amazon OAuth'],
      summary: 'Complete Amazon OAuth callback for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const clientId = process.env.AMAZON_CLIENT_ID
    const clientSecret = process.env.AMAZON_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    const encKey = process.env.CRED_ENCRYPTION_KEY
    const stateSecret = process.env.AMAZON_STATE_SECRET ?? clientSecret
    if (!clientId || !clientSecret || !appBaseUrl || !encKey || !stateSecret) {
      return reply.code(503).send({ error: 'Amazon OAuth not configured' })
    }

    const query = request.query as Record<string, string>

    const statePayload = verifyOAuthState<AmazonStatePayload>(
      query.state ?? '',
      stateSecret,
    )
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (!isOAuthStateFresh(statePayload, STATE_MAX_AGE_MS)) {
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
      await persistOAuthCredential({
        tenantId,
        platform: 'amazon',
        credentialType: 'lwa',
        region,
        accessToken: encryptedRefreshToken,
        metadata: { clientId, sellerId, marketplaceId },
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Amazon OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    return reply.send({ ok: true })
  })
}

export default amazonOAuthRoute
