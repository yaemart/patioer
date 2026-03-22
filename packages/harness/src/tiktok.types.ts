export interface TikTokCredentials {
  appKey: string
  appSecret: string
  accessToken: string
  shopId?: string
}

export interface TikTokProductPrice {
  amount: string
  currency: string
}

export interface TikTokProductSku {
  id: string
  price: { amount: string }
  inventory: number
}

export interface TikTokProduct {
  id: string
  title: string
  status: string
  price: TikTokProductPrice
  inventory: number
  skus?: TikTokProductSku[]
}

export interface TikTokOrder {
  order_id: string
  status: string
  payment_info: { total_amount: string; currency: string }
  create_time: number
  line_items: Array<{ product_id: string; quantity: number }>
}

export interface TikTokApiResponse<T> {
  code: number
  message: string
  data?: T
  request_id?: string
}

export interface TikTokProductListData {
  products: TikTokProduct[]
  next_page_token?: string
  total_count?: number
}

export interface TikTokOrderListData {
  order_list: TikTokOrder[]
  next_page_token?: string
  total_count?: number
}
