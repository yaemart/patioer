import { upsertShopifyOrderFromPayload } from './webhook-orders.js'
import { upsertShopifyProductFromPayload } from './webhook-products.js'

export async function handleWebhookTopic(
  topic: string,
  tenantId: string,
  payload: unknown,
): Promise<void> {
  const body = payload as Record<string, unknown>

  switch (topic) {
    case 'orders/create':
    case 'orders/updated':
      await upsertShopifyOrderFromPayload(tenantId, body)
      break

    case 'products/create':
    case 'products/update':
      await upsertShopifyProductFromPayload(tenantId, body)
      break

    default:
      break
  }
}
