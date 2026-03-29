import { withTenantDb, schema } from '@patioer/db'
import type { ShopifyProductWebhookDto } from './shopify-webhook-normalizer.js'

export async function upsertShopifyProduct(
  tenantId: string,
  product: ShopifyProductWebhookDto,
): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db
      .insert(schema.products)
      .values({
        tenantId,
        platformProductId: product.platformProductId,
        platform: 'shopify',
        title: product.title,
        category: product.category,
        price: product.price,
        attributes: product.attributes,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.products.tenantId,
          schema.products.platform,
          schema.products.platformProductId,
        ],
        set: {
          title: product.title,
          category: product.category,
          price: product.price,
          attributes: product.attributes,
          syncedAt: new Date(),
        },
      })
  })
}
