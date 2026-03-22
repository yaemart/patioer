import { eq } from 'drizzle-orm'
import { withTenantDb, schema } from '@patioer/db'

export async function handleWebhookTopic(
  topic: string,
  tenantId: string,
  payload: unknown,
): Promise<void> {
  const body = payload as Record<string, unknown>

  switch (topic) {
    case 'orders/create': {
      const shopDomain = await getShopDomainForTenant(tenantId)
      if (!shopDomain) return
      const orderId = String(body.id ?? '')
      const status = String(body.financial_status ?? 'unknown')
      const totalPrice = String(body.total_price ?? '0')

      await withTenantDb(tenantId, async (db) => {
        await db
          .insert(schema.orders)
          .values({
            tenantId,
            platformOrderId: orderId,
            platform: 'shopify',
            status,
            totalPrice,
            items: (body.line_items as unknown) ?? null,
          })
          .onConflictDoUpdate({
            target: [schema.orders.tenantId, schema.orders.platform, schema.orders.platformOrderId],
            set: { status, totalPrice },
          })
      })
      break
    }
    default:
      break
  }
}

// platformCredentials has FORCE ROW LEVEL SECURITY — must query via withTenantDb.
async function getShopDomainForTenant(tenantId: string): Promise<string | null> {
  const [cred] = await withTenantDb(tenantId, (db) =>
    db
      .select({ shopDomain: schema.platformCredentials.shopDomain })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.tenantId, tenantId))
      .limit(1),
  )
  return cred?.shopDomain ?? null
}
