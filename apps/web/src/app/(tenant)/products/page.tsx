'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Product {
  id: string
  platformProductId: string
  platform: string
  title: string
  category: string | null
  price: string | null
  syncedAt: string | null
  createdAt: string
}

const PLATFORMS = ['all', 'shopify', 'amazon', 'tiktok', 'shopee', 'walmart'] as const
const PAGE_SIZE = 20

const PLATFORM_BADGE: Record<string, string> = {
  shopify: 'bg-green-50 text-green-700 border-green-200',
  amazon: 'bg-orange-50 text-orange-700 border-orange-200',
  tiktok: 'bg-gray-900 text-white border-gray-700',
  shopee: 'bg-red-50 text-red-700 border-red-200',
  walmart: 'bg-blue-50 text-blue-700 border-blue-200',
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<string>('all')
  const [page, setPage] = useState(0)

  const fetchProducts = useCallback(() => {
    setLoading(true)
    apiFetch<{ products: Product[] }>('/api/v1/products')
      .then((data) => setProducts(data.products))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const filtered = products.filter((p) => {
    if (platform !== 'all' && p.platform !== platform) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        p.title.toLowerCase().includes(q) ||
        p.platformProductId.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  async function handleSync() {
    setSyncing(true)
    try {
      await apiFetch('/api/v1/products/sync', { method: 'POST' })
      fetchProducts()
    } catch {
      /* noop */
    } finally {
      setSyncing(false)
    }
  }

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Products</h1>
            <p className="text-sm text-gray-500 mt-1">
              {products.length} total &middot; {filtered.length} displayed
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing...' : 'Sync Products'}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
          <input
            type="text"
            placeholder="Search by title, ID, or category..."
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

        {/* Table */}
        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading products...</div>
        ) : paged.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">No products found</p>
            <p className="text-sm text-gray-400 mt-1">Try syncing from a connected platform</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Product</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Platform</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Category</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Price</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-gray-900 truncate max-w-xs">{p.title}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{p.platformProductId}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PLATFORM_BADGE[p.platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {p.platform}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{p.category ?? '—'}</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {p.price ? `$${parseFloat(p.price).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-xs text-gray-400">
                      {p.syncedAt ? new Date(p.syncedAt).toLocaleDateString() : 'never'}
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
