import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { tenants } from './schema/tenants.js'

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
