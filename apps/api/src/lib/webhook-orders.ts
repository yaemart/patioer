import { withTenantDb, schema } from '@patioer/db'

export async function upsertShopifyOrderFromPayload(
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const orderId = String(payload.id ?? '')
  const status = String(payload.financial_status ?? 'unknown')
  const totalPrice = String(payload.total_price ?? '0')

  await withTenantDb(tenantId, async (db) => {
    await db
      .insert(schema.orders)
      .values({
        tenantId,
        platformOrderId: orderId,
        platform: 'shopify',
        status,
        totalPrice,
        items: (payload.line_items as unknown) ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.orders.tenantId, schema.orders.platform, schema.orders.platformOrderId],
        set: { status, totalPrice },
      })
  })
}
