import { withTenantDb, schema } from '@patioer/db'

export async function upsertShopifyProductFromPayload(
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const productId = String(payload.id ?? '')
  const title = String(payload.title ?? 'Untitled')
  const category = (payload.product_type as string | undefined) ?? null

  // Shopify sends price on the first variant; default to null if absent.
  const variants = payload.variants as Array<Record<string, unknown>> | undefined
  const price = variants?.[0]?.price != null ? String(variants[0].price) : null

  await withTenantDb(tenantId, async (db) => {
    await db
      .insert(schema.products)
      .values({
        tenantId,
        platformProductId: productId,
        platform: 'shopify',
        title,
        category,
        price,
        attributes: payload,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.products.tenantId,
          schema.products.platform,
          schema.products.platformProductId,
        ],
        set: { title, category, price, attributes: payload, syncedAt: new Date() },
      })
  })
}
