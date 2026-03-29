/**
 * Wayfair B2B configuration registration route.
 *
 * Wayfair does not use Marketplace OAuth — merchants register their
 * Wayfair supplier credentials (API key + supplier ID) via this endpoint.
 * The credentials are encrypted and stored in `platform_credentials` with:
 *   - platform: 'b2b'
 *   - credential_type: 'wayfair_b2b'
 *   - metadata.partner: 'wayfair'
 *   - metadata.supplierId: <supplier ID>
 *
 * This keeps Wayfair out of `SUPPORTED_PLATFORMS` (plan D10).
 */

import type { FastifyPluginAsync } from 'fastify'
import { encryptToken } from '../lib/crypto.js'
import { persistOAuthCredential } from '../lib/oauth-credential-store.js'

const b2bWayfairRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/b2b/wayfair/credentials', {
    schema: {
      tags: ['B2B'],
      summary: 'Register Wayfair B2B supplier credentials for a tenant',
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
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : null
    const supplierId = typeof body.supplierId === 'string' ? body.supplierId : null
    const apiBaseUrl = typeof body.apiBaseUrl === 'string' ? body.apiBaseUrl : null
    const ediEndpoint = typeof body.ediEndpoint === 'string' ? body.ediEndpoint : undefined
    const currency = typeof body.currency === 'string' ? body.currency : 'USD'

    if (!authTenantId) return reply.code(401).send({ error: 'JWT authentication required' })
    if (bodyTenantId && bodyTenantId !== authTenantId) {
      return reply.code(401).send({ error: 'JWT tenant does not match tenantId' })
    }
    if (!apiKey) return reply.code(400).send({ error: 'apiKey is required' })
    if (!supplierId) return reply.code(400).send({ error: 'supplierId is required' })
    if (!apiBaseUrl) return reply.code(400).send({ error: 'apiBaseUrl is required' })

    const tenantId = authTenantId

    const encryptedApiKey = encryptToken(apiKey, encKey)

    try {
      await persistOAuthCredential({
        tenantId,
        platform: 'b2b',
        credentialType: 'wayfair_b2b',
        region: 'global',
        accessToken: encryptedApiKey,
        metadata: {
          partner: 'wayfair',
          supplierId,
          apiBaseUrl,
          ediEndpoint: ediEndpoint ?? null,
          currency,
        },
      })
    } catch (err) {
      app.log.error({ err, tenantId }, 'failed to persist Wayfair B2B credentials')
      return reply.code(500).send({ error: 'failed to save credentials' })
    }

    return reply.send({ ok: true, partner: 'wayfair' })
  })

  app.get('/api/v1/b2b/wayfair/status', {
    schema: {
      tags: ['B2B'],
      summary: 'Check Wayfair B2B connection status for a tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = (request as { tenantId?: string }).tenantId
    if (!tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    if (!request.withDb) {
      return reply.code(500).send({ error: 'db unavailable' })
    }

    const { schema: dbSchema } = await import('@patioer/db')
    const { and, eq } = await import('drizzle-orm')

    const result = await request.withDb(async (db) => {
      const [row] = await db
        .select({
          platform: dbSchema.platformCredentials.platform,
          credentialType: dbSchema.platformCredentials.credentialType,
          metadata: dbSchema.platformCredentials.metadata,
          createdAt: dbSchema.platformCredentials.createdAt,
        })
        .from(dbSchema.platformCredentials)
        .where(
          and(
            eq(dbSchema.platformCredentials.tenantId, tenantId),
            eq(dbSchema.platformCredentials.platform, 'b2b'),
            eq(dbSchema.platformCredentials.credentialType, 'wayfair_b2b'),
          ),
        )
        .limit(1)

      return row ?? null
    })

    if (!result) {
      return reply.send({ connected: false, partner: 'wayfair' })
    }

    const meta = result.metadata as Record<string, unknown> | null
    return reply.send({
      connected: true,
      partner: 'wayfair',
      supplierId: meta?.supplierId ?? null,
      connectedAt: result.createdAt?.toISOString() ?? null,
    })
  })
}

export default b2bWayfairRoute
