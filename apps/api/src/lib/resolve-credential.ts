import type { FastifyRequest } from 'fastify'
import { schema, withTenantDb, type AppDb } from '@patioer/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { SupportedPlatform } from './harness-factory.js'

type CredRow = typeof schema.platformCredentials.$inferSelect

async function queryCredentialForPlatform(
  db: AppDb,
  tenantId: string,
  platform: SupportedPlatform,
): Promise<CredRow | null> {
  const [globalRow] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.tenantId, tenantId),
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
          eq(schema.platformCredentials.tenantId, tenantId),
          eq(schema.platformCredentials.platform, 'shopify'),
          isNull(schema.platformCredentials.region),
        ),
      )
      .limit(1)
    return legacyRow ?? null
  }
  return null
}

/**
 * Resolves Shopify → Amazon credential order (same as HTTP `resolveFirstCredential`).
 * For workers and scripts that do not have a Fastify request.
 */
export async function resolveFirstCredentialForTenant(
  tenantId: string,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  const platforms: readonly SupportedPlatform[] = preferredPlatform
    ? [preferredPlatform]
    : ['shopify', 'amazon']

  return withTenantDb(tenantId, async (db) => {
    for (const platform of platforms) {
      const cred = await queryCredentialForPlatform(db, tenantId, platform)
      if (cred) return { cred, platform }
    }
    return null
  })
}

export async function resolveFirstCredentialFromDb(
  db: AppDb,
  tenantId: string,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  const platforms: readonly SupportedPlatform[] = preferredPlatform
    ? [preferredPlatform]
    : ['shopify', 'amazon']

  for (const platform of platforms) {
    const cred = await queryCredentialForPlatform(db, tenantId, platform)
    if (cred) return { cred, platform }
  }
  return null
}

export async function resolveFirstCredential(
  request: FastifyRequest,
  preferredPlatform?: SupportedPlatform | null,
): Promise<{ cred: CredRow; platform: SupportedPlatform } | null> {
  if (!request.withDb || !request.tenantId) return null

  return request.withDb(async (db) => resolveFirstCredentialFromDb(db, request.tenantId!, preferredPlatform))
}
