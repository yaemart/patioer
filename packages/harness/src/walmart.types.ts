/**
 * Walmart Marketplace API credentials.
 *
 * Authentication uses Client Credentials grant (clientId + clientSecret → short-lived token).
 * `credential_type` in `platform_credentials` is `client_credentials`.
 * `region` is stored in `platform_credentials.metadata.region` (us | ca | mx).
 */
export interface WalmartCredentials {
  clientId: string
  clientSecret: string
  region: 'us' | 'ca' | 'mx'
  /**
   * When true (default) the harness connects to the Walmart sandbox endpoints,
   * allowing development and CI runs without a real Seller Center account.
   * Set to false to hit production endpoints.
   */
  useSandbox?: boolean
}

export interface WalmartTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface WalmartItemSummary {
  sku: string
  productName?: string
  price?: { amount?: number; currency?: string }
  publishedStatus?: string
  lifecycleStatus?: string
  wpid?: string
  upc?: string
  gtin?: string
}

export interface WalmartItemsResponse {
  ItemResponse?: WalmartItemSummary[]
  totalItems?: number
  nextCursor?: string
}

export interface WalmartOrderLine {
  lineNumber: string
  item: { sku: string; productName?: string }
  charges: { charge: Array<{ chargeAmount: { amount: number; currency?: string } }> }
  orderLineStatuses?: { orderLineStatus: Array<{ status: string }> }
}

export interface WalmartOrderSummary {
  purchaseOrderId: string
  customerOrderId: string
  orderDate: string
  shippingInfo?: { estimatedDeliveryDate?: string }
  orderLines: { orderLine: WalmartOrderLine[] }
}

export interface WalmartOrdersResponse {
  list?: { elements?: { order?: WalmartOrderSummary[] }; meta?: { nextCursor?: string; totalCount?: number } }
}

export interface WalmartInventoryItem {
  sku: string
  quantity: { unit: string; amount: number }
  fulfillmentLagTime?: number
}

export interface WalmartInventoryResponse {
  inventoryItems?: WalmartInventoryItem[]
  totalItems?: number
  nextCursor?: string
}
