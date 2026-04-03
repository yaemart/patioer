'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Order {
  id: string
  platformOrderId: string
  platform: string
  status: string
  items: unknown
  totalPrice: string | null
  createdAt: string
}

const PLATFORMS = ['all', 'shopify', 'amazon', 'tiktok', 'shopee', 'walmart'] as const
const PAGE_SIZE = 20

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  processing: 'bg-blue-50 text-blue-700',
  shipped: 'bg-indigo-50 text-indigo-700',
  delivered: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
  refunded: 'bg-gray-100 text-gray-600',
}

const PLATFORM_BADGE: Record<string, string> = {
  shopify: 'bg-green-50 text-green-700 border-green-200',
  amazon: 'bg-orange-50 text-orange-700 border-orange-200',
  tiktok: 'bg-gray-900 text-white border-gray-700',
  shopee: 'bg-red-50 text-red-700 border-red-200',
  walmart: 'bg-blue-50 text-blue-700 border-blue-200',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page, setPage] = useState(0)

  const fetchOrders = useCallback(() => {
    setLoading(true)
    apiFetch<{ orders: Order[] }>('/api/v1/orders')
      .then((data) => setOrders(data.orders))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const statuses = ['all', ...new Set(orders.map((o) => o.status))]

  const filtered = orders.filter((o) => {
    if (platform !== 'all' && o.platform !== platform) return false
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        o.platformOrderId.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q)
      )
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const totalRevenue = filtered.reduce((sum, o) => sum + (o.totalPrice ? parseFloat(o.totalPrice) : 0), 0)

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
            <p className="text-sm text-gray-500 mt-1">
              {orders.length} total &middot; {filtered.length} displayed
              {totalRevenue > 0 && ` · $${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue`}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
          <input
            type="text"
            placeholder="Search by order ID or status..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex gap-1.5 flex-wrap">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setPage(0) }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  platform === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter */}
        {statuses.length > 1 && (
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(0) }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading orders...</div>
        ) : paged.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">No orders found</p>
            <p className="text-sm text-gray-400 mt-1">Orders appear after platform sync</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Order ID</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Platform</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Total</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-gray-900">{o.platformOrderId}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PLATFORM_BADGE[o.platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {o.platform}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {o.totalPrice ? `$${parseFloat(o.totalPrice).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-xs text-gray-400">
                      {new Date(o.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage(currentPage + 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
