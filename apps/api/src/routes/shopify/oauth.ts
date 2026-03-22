import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { withTenantDb, schema } from '@patioer/db'
import { encryptToken } from '../../lib/crypto.js'
import { registry } from '../../lib/harness-registry.js'

const SHOPIFY_SCOPES =
  'read_products,write_products,read_inventory,write_inventory,read_orders'

const shopDomainSchema = z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/)

// --- CSRF state helpers ---
// State format: <base64url(payload)>.<hex-hmac>
// payload = JSON { tenantId, nonce, iat }

function signState(tenantId: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId, nonce: randomBytes(8).toString('hex'), iat: Date.now() }),
  ).toString('base64url')
  const hmac = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

function verifyState(
  state: string,
  secret: string,
): { tenantId: string; iat: number } | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null
  const payload = state.slice(0, dot)
  const hmac = state.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const hmacBuf = Buffer.from(hmac, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (hmacBuf.length !== expectedBuf.length || !timingSafeEqual(hmacBuf, expectedBuf)) {
    return null
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tenantId: string
      iat: number
    }
  } catch {
    return null
  }
}

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
  app.get('/api/v1/shopify/auth', async (request, reply) => {
    const clientId = process.env.SHOPIFY_CLIENT_ID
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    if (!clientId || !clientSecret || !appBaseUrl) {
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

    const state = signState(tenantId, clientSecret)
    const redirectUri = `${appBaseUrl}/api/v1/shopify/callback`
    const authUrl = new URL(`https://${shopParse.data}/admin/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('scope', SHOPIFY_SCOPES)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', state)

    return reply.redirect(authUrl.toString())
  })

  // Step 2 — Exchange authorization code for a permanent access token.
  app.get('/api/v1/shopify/callback', async (request, reply) => {
    const clientId = process.env.SHOPIFY_CLIENT_ID
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
    const encryptionKey = process.env.SHOPIFY_ENCRYPTION_KEY
    if (!clientId || !clientSecret || !encryptionKey) {
      return reply.code(503).send({ error: 'Shopify OAuth not configured' })
    }

    const query = request.query as Record<string, string>

    // Validate Shopify's HMAC to ensure the callback is genuine
    if (!verifyShopifyHmac(query, clientSecret)) {
      return reply.code(401).send({ error: 'invalid HMAC' })
    }

    // Validate our own CSRF state (proves the user started this flow)
    const statePayload = verifyState(query.state ?? '', clientSecret)
    if (!statePayload) {
      return reply.code(400).send({ error: 'invalid state' })
    }
    if (Date.now() - statePayload.iat > 10 * 60 * 1000) {
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

    // Persist encrypted credentials — use withTenantDb for RLS isolation
    try {
      await withTenantDb(statePayload.tenantId, async (db) => {
        await db
          .insert(schema.platformCredentials)
          .values({
            tenantId: statePayload.tenantId,
            platform: 'shopify',
            region: 'global',
            shopDomain: shopParse.data,
            accessToken: encryptedToken,
            scopes: tokenData.scope.split(','),
          })
          .onConflictDoUpdate({
            target: [
              schema.platformCredentials.tenantId,
              schema.platformCredentials.platform,
              schema.platformCredentials.region,
            ],
            set: {
              shopDomain: shopParse.data,
              accessToken: encryptedToken,
              scopes: tokenData.scope.split(','),
            },
          })
      })
    } catch (err) {
      app.log.error({ err, tenantId: statePayload.tenantId }, 'failed to persist OAuth credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    registry.invalidate(`${statePayload.tenantId}:shopify`)

    return reply.send({ ok: true })
  })
}

export default shopifyOauthRoute
