import { withTenantDb, schema } from '@patioer/db'
import type { ShopifyOrderWebhookDto } from './shopify-webhook-normalizer.js'

export async function upsertShopifyOrder(
  tenantId: string,
  order: ShopifyOrderWebhookDto,
): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db
      .insert(schema.orders)
      .values({
        tenantId,
        platformOrderId: order.platformOrderId,
        platform: 'shopify',
        status: order.status,
        totalPrice: order.totalPrice,
        items: order.items,
      })
      .onConflictDoUpdate({
        target: [schema.orders.tenantId, schema.orders.platform, schema.orders.platformOrderId],
        set: { status: order.status, totalPrice: order.totalPrice },
      })
  })
}
