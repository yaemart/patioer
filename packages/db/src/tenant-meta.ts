import { eq, and } from 'drizzle-orm'
import { db, withTenantDb } from './client.js'
import { tenants } from './schema/tenants.js'
import { platformCredentials } from './schema/platform-credentials.js'

export interface TenantPublicMetadata {
  id: string
  slug: string
}

/**
 * System-level tenant id enumeration.
 *
 * The tenants table is intentionally excluded from tenant RLS so scheduler/
 * replay/bootstrap jobs can enumerate tenants first, then switch to RLS-safe
 * access with withTenantDb for tenant-scoped tables.
 */
export const listTenantIds = async (): Promise<string[]> => {
  const rows = await db.select({ id: tenants.id }).from(tenants)
  return rows.map((row) => row.id)
}

/**
 * Tenant discovery should only return the minimum fields required by callers.
 * Never expose internal metadata (name, plan, paperclip ids) from this helper.
 */
export const getTenantPublicBySlug = async (
  slug: string,
): Promise<TenantPublicMetadata | null> => {
  const [row] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1)

  return row ?? null
}

/**
 * Resolves tenantId from a platform shop domain by querying
 * platform_credentials within each tenant's RLS context.
 *
 * platform_credentials has FORCE ROW LEVEL SECURITY — the global `db`
 * connection cannot read it (current_setting('app.tenant_id') would be NULL,
 * causing a policy error). We iterate the RLS-free tenants table and probe
 * each tenant's credentials in withTenantDb, matching the pattern used by
 * bootstrapActiveAgents and replayPendingWebhooks.
 */
export const getTenantIdByShopDomain = async (
  platform: string,
  shopDomain: string,
): Promise<string | null> => {
  const tenantIds = await listTenantIds()

  for (const tenantId of tenantIds) {
    const [row] = await withTenantDb(tenantId, (tdb) =>
      tdb
        .select({ tenantId: platformCredentials.tenantId })
        .from(platformCredentials)
        .where(
          and(
            eq(platformCredentials.platform, platform),
            eq(platformCredentials.shopDomain, shopDomain),
          ),
        )
        .limit(1),
    )
    if (row) return row.tenantId
  }

  return null
}
