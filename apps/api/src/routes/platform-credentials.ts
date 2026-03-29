import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { UUID_LOOSE_RE } from '@patioer/shared'
import { encryptToken } from '../lib/crypto.js'
import { registry } from '../lib/harness-registry.js'

const paramsSchema = z.object({ id: z.string().regex(UUID_LOOSE_RE).transform((v) => v.toLowerCase()) })

const createBodySchema = z.object({
  platform: z.string().min(1),
  accessToken: z.string().min(1),
  credentialType: z.string().optional(),
  shopDomain: z.string().optional(),
  region: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
})

const patchBodySchema = z.object({
  accessToken: z.string().min(1).optional(),
  shopDomain: z.string().optional(),
  region: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'at least one field must be provided' },
)

/** Shared redacted select columns (never includes accessToken). */
const redactedSelect = {
  id: schema.platformCredentials.id,
  platform: schema.platformCredentials.platform,
  credentialType: schema.platformCredentials.credentialType,
  shopDomain: schema.platformCredentials.shopDomain,
  region: schema.platformCredentials.region,
  scopes: schema.platformCredentials.scopes,
  metadata: schema.platformCredentials.metadata,
  expiresAt: schema.platformCredentials.expiresAt,
  createdAt: schema.platformCredentials.createdAt,
} as const

const platformCredentialsRoute: FastifyPluginAsync = async (app) => {
  // List connected platform credentials for a tenant.
  // SECURITY: accessToken is always redacted — only metadata is returned.
  app.get('/api/v1/platform-credentials', {
    schema: { tags: ['Platform Credentials'], summary: 'List connected platforms', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const rows = await request.withDb((db) =>
      db
        .select(redactedSelect)
        .from(schema.platformCredentials)
        .where(eq(schema.platformCredentials.tenantId, request.tenantId!)),
    )

    return reply.send({ credentials: rows })
  })

  // Get a single credential by ID (still redacted).
  app.get('/api/v1/platform-credentials/:id', {
    schema: { tags: ['Platform Credentials'], summary: 'Get credential by ID', security: [{ bearerAuth: [] }] },
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
        .select(redactedSelect)
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

  // Create or update (upsert) a credential.
  // Agents can call this to register / refresh tokens programmatically.
  // SECURITY: accessToken is encrypted with AES-256-GCM before storage.
  app.post('/api/v1/platform-credentials', {
    schema: { tags: ['Platform Credentials'], summary: 'Register or refresh a platform credential', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const encryptionKey = process.env['CRED_ENCRYPTION_KEY']
    if (!encryptionKey) {
      return reply.code(503).send({ error: 'credential encryption not configured' })
    }

    const parsed = createBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    const { platform, accessToken, credentialType, shopDomain, region, scopes, metadata, expiresAt } = parsed.data
    const encryptedToken = encryptToken(accessToken, encryptionKey)

    const [row] = await request.withDb((db) =>
      db
        .insert(schema.platformCredentials)
        .values({
          tenantId: request.tenantId!,
          platform,
          credentialType: credentialType ?? 'oauth',
          shopDomain: shopDomain ?? null,
          region: region ?? 'global',
          accessToken: encryptedToken,
          scopes: scopes ?? null,
          metadata: metadata ?? null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        })
        .onConflictDoUpdate({
          target: [
            schema.platformCredentials.tenantId,
            schema.platformCredentials.platform,
            schema.platformCredentials.region,
          ],
          set: {
            accessToken: encryptedToken,
            shopDomain: shopDomain ?? null,
            scopes: scopes ?? null,
            metadata: metadata ?? null,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        })
        .returning(redactedSelect),
    )

    registry.invalidate(`${request.tenantId}:${platform}`)
    return reply.code(201).send({ credential: row })
  })

  // Update individual fields of an existing credential (e.g. token refresh, metadata update).
  app.patch('/api/v1/platform-credentials/:id', {
    schema: { tags: ['Platform Credentials'], summary: 'Update a platform credential', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid credential id' })
    }

    const parsed = patchBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    const encryptionKey = process.env['CRED_ENCRYPTION_KEY']
    if (parsed.data.accessToken && !encryptionKey) {
      return reply.code(503).send({ error: 'credential encryption not configured' })
    }

    const { accessToken, shopDomain, region, scopes, metadata, expiresAt } = parsed.data

    const setFields: Record<string, unknown> = {}
    if (accessToken !== undefined) setFields['accessToken'] = encryptToken(accessToken, encryptionKey!)
    if (shopDomain !== undefined) setFields['shopDomain'] = shopDomain
    if (region !== undefined) setFields['region'] = region
    if (scopes !== undefined) setFields['scopes'] = scopes
    if (metadata !== undefined) setFields['metadata'] = metadata
    if (expiresAt !== undefined) setFields['expiresAt'] = new Date(expiresAt)

    const [row] = await request.withDb((db) =>
      db
        .update(schema.platformCredentials)
        .set(setFields)
        .where(
          and(
            eq(schema.platformCredentials.id, parsedParams.data.id),
            eq(schema.platformCredentials.tenantId, request.tenantId!),
          ),
        )
        .returning(redactedSelect),
    )

    if (!row) {
      return reply.code(404).send({ error: 'credential not found' })
    }

    registry.invalidate(`${request.tenantId}:${row.platform}`)
    return reply.send({ credential: row })
  })

  // Delete a credential and invalidate the harness cache for that platform.
  app.delete('/api/v1/platform-credentials/:id', {
    schema: { tags: ['Platform Credentials'], summary: 'Disconnect a platform', security: [{ bearerAuth: [] }] },
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
