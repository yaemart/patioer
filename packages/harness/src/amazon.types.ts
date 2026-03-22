export interface AmazonCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  sellerId: string
  marketplaceId: string
  region: 'na' | 'eu' | 'fe'
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
