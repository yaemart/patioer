export type ShopeeMarket = 'SG' | 'MY' | 'TH' | 'PH' | 'ID' | 'VN'

// All live markets share the same base domain; routing is handled by shop_id.
export const SHOPEE_MARKET_ENDPOINTS: Record<ShopeeMarket, string> = {
  SG: 'https://partner.shopeemobile.com',
  MY: 'https://partner.shopeemobile.com',
  TH: 'https://partner.shopeemobile.com',
  PH: 'https://partner.shopeemobile.com',
  ID: 'https://partner.shopeemobile.com',
  VN: 'https://partner.shopeemobile.com',
}

export const SHOPEE_SANDBOX_ENDPOINT = 'https://partner.test-stable.shopeemobile.com'

export interface ShopeeCredentials {
  partnerId: number
  partnerKey: string
  accessToken: string
  shopId: number
  market: ShopeeMarket
  sandbox?: boolean
}

export interface ShopeeItem {
  item_id: number
  item_name: string
  price_info?: Array<{ current_price: number; currency: string }>
  stock_info_v2?: { summary_info?: { total_available_stock: number } }
}

/** Response from `/api/v2/product/get_item_list` */
export interface ShopeeItemListResponse {
  item?: Array<{ item_id: number; item_status: string }>
  total_count?: number
  has_next_page?: boolean
  next_offset?: number
}

/** Response from `/api/v2/product/get_item_base_info` */
export interface ShopeeItemDetailResponse {
  item_list?: ShopeeItem[]
}

export interface ShopeeOrder {
  order_sn: string
  order_status: string
  total_amount: number
  currency: string
  create_time: number
}

/** Response from `/api/v2/order/get_order_list` */
export interface ShopeeOrderListResponse {
  order_list?: ShopeeOrder[]
  more?: boolean
  next_cursor?: string
}

export interface ShopeeApiResponse<T> {
  error: string
  message: string
  response?: T
  request_id?: string
}
