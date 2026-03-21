export interface Product {
  id: string
  title: string
  price: number
  inventory: number
}

export interface Order {
  id: string
  status: string
  totalPrice: number
}

export interface Thread {
  id: string
  subject: string
}

export interface DateRange {
  from: Date
  to: Date
}

export interface Analytics {
  revenue: number
  orders: number
}

export interface GetProductsOpts {
  cursor?: string
  limit?: number
}

export interface GetOrdersOpts {
  cursor?: string
  limit?: number
}
