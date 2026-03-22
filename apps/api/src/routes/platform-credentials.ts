import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { registry } from '../lib/harness-registry.js'

const paramsSchema = z.object({ id: z.string().uuid() })

const platformCredentialsRoute: FastifyPluginAsync = async (app) => {
  // List connected platform credentials for a tenant.
  // SECURITY: accessToken is always redacted — only metadata is returned.
  app.get('/api/v1/platform-credentials', {
    schema: { tags: ['Platform Credentials'], summary: 'List connected platforms', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const rows = await request.withDb((db) =>
      db
        .select({
          id: schema.platformCredentials.id,
          platform: schema.platformCredentials.platform,
          credentialType: schema.platformCredentials.credentialType,
          shopDomain: schema.platformCredentials.shopDomain,
          region: schema.platformCredentials.region,
          scopes: schema.platformCredentials.scopes,
          metadata: schema.platformCredentials.metadata,
          expiresAt: schema.platformCredentials.expiresAt,
          createdAt: schema.platformCredentials.createdAt,
        })
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.tenantId, request.tenantId!)),
    )

    return reply.send({ credentials: rows })
  })

  // Get a single credential by ID (still redacted).
  app.get('/api/v1/platform-credentials/:id', {
    schema: { tags: ['Platform Credentials'], summary: 'Get credential by ID', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid credential id' })
    }

    const [row] = await request.withDb((db) =>
      db
        .select({
          id: schema.platformCredentials.id,
          platform: schema.platformCredentials.platform,
          credentialType: schema.platformCredentials.credentialType,
          shopDomain: schema.platformCredentials.shopDomain,
          region: schema.platformCredentials.region,
          scopes: schema.platformCredentials.scopes,
          metadata: schema.platformCredentials.metadata,
          expiresAt: schema.platformCredentials.expiresAt,
          createdAt: schema.platformCredentials.createdAt,
        })
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.id, parsedParams.data.id),
            eq(schema.platformCredentials.tenantId, request.tenantId!),
          ),
        )
        .limit(1),
    )

    if (!row) {
      return reply.code(404).send({ error: 'credential not found' })
    }
    return reply.send({ credential: row })
  })

  // Delete a credential and invalidate the harness cache for that platform.
  app.delete('/api/v1/platform-credentials/:id', {
    schema: { tags: ['Platform Credentials'], summary: 'Disconnect a platform', security: [{ tenantId: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid credential id' })
    }

    const [deleted] = await request.withDb((db) =>
      db
        .delete(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.id, parsedParams.data.id),
            eq(schema.platformCredentials.tenantId, request.tenantId!),
          ),
        )
        .returning(),
    )

    if (!deleted) {
      return reply.code(404).send({ error: 'credential not found' })
    }

    registry.invalidate(`${request.tenantId}:${deleted.platform}`)
    return reply.code(204).send()
  })
}

export default platformCredentialsRoute
