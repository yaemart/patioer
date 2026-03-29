import type { FastifyPluginAsync } from 'fastify'
import { encryptToken } from '../../lib/crypto.js'
import { persistOAuthCredential } from '../../lib/oauth-credential-store.js'
import { isOAuthStateFresh, signOAuthState, verifyOAuthState } from '../../lib/oauth-state.js'
import { parseWalmartRegion } from '../../lib/walmart-region.js'

const STATE_MAX_AGE_MS = 10 * 60 * 1000

interface WalmartStatePayload {
  tenantId: string
  region: string
  nonce: string
  iat: number
}

/**
 * Walmart uses Client Credentials (clientId + clientSecret), not a redirect-based
 * OAuth flow. This route provides a credential-registration endpoint that:
 *   1. Accepts clientId + clientSecret from the merchant
 *   2. Encrypts the clientSecret with CRED_ENCRYPTION_KEY
 *   3. Persists to platform_credentials with credential_type='client_credentials'
 *
 * A separate GET endpoint is available for redirect-style onboarding flows that
 * pass state via signed HMAC for CSRF protection (like Amazon/Shopee).
 */
const walmartOAuthRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/walmart/credentials', {
    schema: {
      tags: ['Walmart'],
      summary: 'Register Walmart Marketplace credentials for a tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const encKey = process.env.CRED_ENCRYPTION_KEY
    if (!encKey) {
      return reply.code(503).send({ error: 'Credential encryption not configured' })
    }

    const body = request.body as Record<string, unknown>
    const authTenantId = request.tenantId
    const bodyTenantId = typeof body.tenantId === 'string' ? body.tenantId : null
    const clientId = typeof body.clientId === 'string' ? body.clientId : null
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : null
    const regionRaw = typeof body.region === 'string' ? body.region : 'us'

    if (!authTenantId) return reply.code(401).send({ error: 'JWT authentication required' })
    if (bodyTenantId && bodyTenantId !== authTenantId) {
      return reply.code(401).send({ error: 'JWT tenant does not match tenantId' })
    }
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })
    if (!clientSecret) return reply.code(400).send({ error: 'clientSecret is required' })

    const tenantId = authTenantId

    let region: string
    try {
      region = parseWalmartRegion(regionRaw)
    } catch {
      return reply.code(400).send({ error: `Invalid region: ${regionRaw}` })
    }

    const encryptedSecret = encryptToken(clientSecret, encKey)

    try {
      await persistOAuthCredential({
        tenantId,
        platform: 'walmart',
        credentialType: 'client_credentials',
        region,
        accessToken: encryptedSecret,
        metadata: { clientId, region },
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Walmart credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    return reply.send({ ok: true })
  })

  app.get('/api/v1/walmart/auth', {
    schema: {
      tags: ['Walmart'],
      summary: 'Start Walmart credential registration (redirect-style)',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const stateSecret = process.env.WALMART_STATE_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    if (!stateSecret || !appBaseUrl) {
      return reply.code(503).send({ error: 'Walmart auth not configured' })
    }

    const query = request.query as Record<string, string>
    const authTenantId = request.tenantId
    const queryTenantId = typeof query.tenantId === 'string' ? query.tenantId : null
    const region = typeof query.region === 'string' ? query.region : 'us'
    if (!authTenantId) return reply.code(401).send({ error: 'JWT authentication required' })
    if (queryTenantId && queryTenantId !== authTenantId) {
      return reply.code(401).send({ error: 'JWT tenant does not match tenantId' })
    }

    const state = signOAuthState({ tenantId: authTenantId, region }, stateSecret)
    const callbackUrl = `${appBaseUrl}/api/v1/walmart/auth/callback?state=${encodeURIComponent(state)}`
    return reply.redirect(callbackUrl)
  })

  app.get('/api/v1/walmart/auth/callback', {
    schema: {
      tags: ['Walmart'],
      summary: 'Complete Walmart credential registration callback',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const stateSecret = process.env.WALMART_STATE_SECRET
    if (!stateSecret) {
      return reply.code(503).send({ error: 'Walmart auth not configured' })
    }

    const query = request.query as Record<string, string>
    const authTenantId = request.tenantId
    const statePayload = verifyOAuthState<WalmartStatePayload>(query.state ?? '', stateSecret)
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (!isOAuthStateFresh(statePayload, STATE_MAX_AGE_MS)) {
      return reply.code(400).send({ error: 'OAuth state expired' })
    }
    if (!authTenantId) {
      return reply.code(401).send({ error: 'JWT authentication required' })
    }
    if (statePayload.tenantId !== authTenantId) {
      return reply.code(401).send({ error: 'JWT tenant does not match OAuth state' })
    }

    let region: string
    try {
      region = parseWalmartRegion(statePayload.region)
    } catch {
      return reply.code(400).send({ error: `Invalid region: ${statePayload.region}` })
    }

    return reply.send({
      ok: true,
      tenantId: statePayload.tenantId,
      region,
      nextStep: 'submit_credentials_via_post',
    })
  })
}

export default walmartOAuthRoute
