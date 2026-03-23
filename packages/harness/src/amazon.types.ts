export interface AmazonCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  sellerId: string
  marketplaceId: string
  region: 'na' | 'eu' | 'fe'
  /**
   * When true (default) the harness connects to the Amazon SP-API sandbox endpoints,
   * allowing development and CI runs without a real Seller Central account.
   * Set to false to hit production endpoints (requires an approved SP-API application).
   */
  useSandbox?: boolean
}

export interface AmazonLwaTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface AmazonCatalogItemSummary {
  asin: string
  sku?: string
  title?: string
}

export interface AmazonOrderSummary {
  AmazonOrderId: string
  OrderStatus: string
  OrderTotal?: { Amount: string; CurrencyCode?: string }
}
