import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { encryptToken } from '../../lib/crypto.js'
import { persistOAuthCredential } from '../../lib/oauth-credential-store.js'
import { isOAuthStateFresh, signOAuthState, verifyOAuthState } from '../../lib/oauth-state.js'

const SHOPIFY_SCOPES =
  'read_products,write_products,read_inventory,write_inventory,read_orders'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

const shopDomainSchema = z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/)

// Verifies the HMAC Shopify appends to OAuth callback query params.
function verifyShopifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query
  if (!hmac) return false
  const message = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const expected = createHmac('sha256', secret).update(message).digest('hex')
  const hmacBuf = Buffer.from(hmac, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (hmacBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(hmacBuf, expectedBuf)
}

const shopifyOauthRoute: FastifyPluginAsync = async (app) => {
  // Step 1 — Redirect merchant to Shopify's OAuth consent screen.
  // Requires x-tenant-id header so we can bind the OAuth state to the tenant.
  app.get('/api/v1/shopify/auth', {
    schema: {
      tags: ['Shopify OAuth'],
      summary: 'Start Shopify OAuth for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const clientId = process.env.SHOPIFY_CLIENT_ID
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    const stateSecret = process.env.SHOPIFY_STATE_SECRET ?? clientSecret
    if (!clientId || !clientSecret || !appBaseUrl || !stateSecret) {
      return reply.code(503).send({ error: 'Shopify OAuth not configured' })
    }

    const tenantId = request.tenantId
    if (!tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const query = request.query as Record<string, string>
    const shopParse = shopDomainSchema.safeParse(query.shop)
    if (!shopParse.success) {
      return reply.code(400).send({ error: 'invalid shop domain' })
    }

    const state = signOAuthState({ tenantId }, stateSecret)
    const redirectUri = `${appBaseUrl}/api/v1/shopify/callback`
    const authUrl = new URL(`https://${shopParse.data}/admin/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('scope', SHOPIFY_SCOPES)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', state)

    return reply.redirect(authUrl.toString())
  })

  // Step 2 — Exchange authorization code for a permanent access token.
  app.get('/api/v1/shopify/callback', {
    schema: {
      tags: ['Shopify OAuth'],
      summary: 'Complete Shopify OAuth callback for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const clientId = process.env.SHOPIFY_CLIENT_ID
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    const encryptionKey = process.env.CRED_ENCRYPTION_KEY ?? process.env.SHOPIFY_ENCRYPTION_KEY
    const stateSecret = process.env.SHOPIFY_STATE_SECRET ?? clientSecret
    if (!clientId || !clientSecret || !encryptionKey || !stateSecret) {
      return reply.code(503).send({ error: 'Shopify OAuth not configured' })
    }

    const query = request.query as Record<string, string>

    // Validate Shopify's HMAC to ensure the callback is genuine
    if (!verifyShopifyHmac(query, clientSecret)) {
      return reply.code(401).send({ error: 'invalid HMAC' })
    }

    // Validate our own CSRF state (proves the user started this flow)
    const statePayload = verifyOAuthState<{ tenantId: string; nonce: string; iat: number }>(
      query.state ?? '',
      stateSecret,
    )
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (!isOAuthStateFresh(statePayload, STATE_MAX_AGE_MS)) {
      return reply.code(400).send({ error: 'OAuth state expired' })
    }

    const shopParse = shopDomainSchema.safeParse(query.shop)
    if (!shopParse.success) {
      return reply.code(400).send({ error: 'invalid shop domain' })
    }

    if (typeof query.code !== 'string' || query.code.length === 0) {
      return reply.code(400).send({ error: 'missing authorization code' })
    }

    // Exchange the authorization code for a permanent access token
    let tokenRes: Response
    try {
      tokenRes = await fetch(`https://${shopParse.data}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: query.code }),
      })
    } catch (err) {
      app.log.error({ err, shop: shopParse.data }, 'Shopify token exchange network error')
      return reply.code(502).send({ error: 'failed to reach Shopify' })
    }
    if (!tokenRes.ok) {
      return reply.code(502).send({ error: 'failed to exchange OAuth token' })
    }

    let tokenData: { access_token: string; scope: string }
    try {
      tokenData = (await tokenRes.json()) as { access_token: string; scope: string }
    } catch {
      return reply.code(502).send({ error: 'invalid token response from Shopify' })
    }

    const encryptedToken = encryptToken(tokenData.access_token, encryptionKey)

    try {
      await persistOAuthCredential({
        tenantId: statePayload.tenantId,
        platform: 'shopify',
        region: 'global',
        shopDomain: shopParse.data,
        accessToken: encryptedToken,
        scopes: tokenData.scope.split(','),
      })
    } catch (err) {
      app.log.error({ err, tenantId: statePayload.tenantId }, 'failed to persist OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    return reply.send({ ok: true })
  })
}

export default shopifyOauthRoute
