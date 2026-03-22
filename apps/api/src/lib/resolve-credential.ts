import type { FastifyRequest } from 'fastify'
import { schema } from '@patioer/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { SupportedPlatform } from './harness-factory.js'

type CredRow = typeof schema.platformCredentials.$inferSelect

export async function resolveFirstCredential(
  request: FastifyRequest,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  if (!request.withDb || !request.tenantId) return null

  const platforms: readonly SupportedPlatform[] = preferredPlatform
    ? [preferredPlatform]
    : ['shopify', 'amazon']

  for (const platform of platforms) {
    const rawCred = await request.withDb(async (db) => {
      const [globalRow] = await db
        .select()
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.tenantId, request.tenantId!),
            eq(schema.platformCredentials.platform, platform),
            eq(schema.platformCredentials.region, 'global'),
          ),
        )
        .limit(1)
      if (globalRow) return globalRow

      if (platform === 'shopify') {
        const [legacyRow] = await db
          .select()
          .from(schema.platformCredentials)
          .where(
            and(
              eq(schema.platformCredentials.tenantId, request.tenantId!),
              eq(schema.platformCredentials.platform, 'shopify'),
              isNull(schema.platformCredentials.region),
            ),
          )
          .limit(1)
        return legacyRow ?? null
      }
      return null
    })
    const cred = Array.isArray(rawCred) ? (rawCred[0] ?? null) : rawCred
    if (cred) return { cred, platform }
  }

  return null
}
