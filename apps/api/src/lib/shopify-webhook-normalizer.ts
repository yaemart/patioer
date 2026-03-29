export interface ShopifyOrderWebhookDto {
  platformOrderId: string
  status: string
  totalPrice: string
  items: unknown
}

export interface ShopifyProductWebhookDto {
  platformProductId: string
  title: string
  category: string | null
  price: string | null
  attributes: Record<string, unknown>
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>
  }

  return {}
}

export function normalizeShopifyOrderPayload(payload: unknown): ShopifyOrderWebhookDto {
  const body = asRecord(payload)

  return {
    platformOrderId: String(body.id ?? ''),
    status: String(body.financial_status ?? 'unknown'),
    totalPrice: String(body.total_price ?? '0'),
    items: body.line_items ?? null,
  }
}

export function normalizeShopifyProductPayload(payload: unknown): ShopifyProductWebhookDto {
  const body = asRecord(payload)
  const variants = Array.isArray(body.variants)
    ? (body.variants as Array<Record<string, unknown>>)
    : []
  const firstVariant = variants[0]
  const price = firstVariant?.price != null ? String(firstVariant.price) : null

  return {
    platformProductId: String(body.id ?? ''),
    title: String(body.title ?? 'Untitled'),
    category: typeof body.product_type === 'string' ? body.product_type : null,
    price,
    attributes: body,
  }
}
