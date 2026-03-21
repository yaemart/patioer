import { eq, and } from 'drizzle-orm'
import { db } from './client.js'
import { tenants } from './schema/tenants.js'
import { platformCredentials } from './schema/platform-credentials.js'

export interface TenantPublicMetadata {
  id: string
  slug: string
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
 * Resolves tenantId from a Shopify shop domain by looking up
 * platform_credentials.  Uses the global `db` (not withTenantDb) because
 * the caller (webhook handler) does not yet know the tenant context —
 * this is a metadata lookup, same pattern as getTenantPublicBySlug.
 *
 * Only returns `tenantId`; never expose tokens or scopes from this helper.
 */
export const getTenantIdByShopDomain = async (
  platform: string,
  shopDomain: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ tenantId: platformCredentials.tenantId })
    .from(platformCredentials)
    .where(
      and(
        eq(platformCredentials.platform, platform),
        eq(platformCredentials.shopDomain, shopDomain),
      ),
    )
    .limit(1)

  return row?.tenantId ?? null
}
