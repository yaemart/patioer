'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface InventoryItem {
  id: string
  productId: string
  platform: string
  quantity: number
  safetyThreshold: number | null
  status: string
  syncedAt: string | null
  createdAt: string
}

interface InboundShipment {
  id: string
  platform: string
  shipmentId: string
  status: string
  quantityShipped: number
  quantityReceived: number
  estimatedArrival: string | null
  createdAt: string
}

type ViewMode = 'all' | 'alerts' | 'inbound'

const STATUS_STYLE: Record<string, string> = {
  normal: 'bg-emerald-50 text-emerald-700',
  low: 'bg-amber-50 text-amber-700',
  out_of_stock: 'bg-red-50 text-red-700',
}

const PLATFORM_BADGE: Record<string, string> = {
  shopify: 'bg-green-50 text-green-700 border-green-200',
  amazon: 'bg-orange-50 text-orange-700 border-orange-200',
  tiktok: 'bg-gray-900 text-white border-gray-700',
  shopee: 'bg-red-50 text-red-700 border-red-200',
  walmart: 'bg-blue-50 text-blue-700 border-blue-200',
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [alerts, setAlerts] = useState<InventoryItem[]>([])
  const [inbound, setInbound] = useState<InboundShipment[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ViewMode>('all')
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<string>('all')

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ items: InventoryItem[] }>('/api/v1/inventory'),
      apiFetch<{ items: InventoryItem[] }>('/api/v1/inventory/alerts'),
      apiFetch<{ shipments: InboundShipment[] }>('/api/v1/inventory/inbound').catch(() => ({ shipments: [] })),
    ])
      .then(([inv, alt, ib]) => {
        setItems(inv.items)
        setAlerts(alt.items)
        setInbound(ib.shipments)
      })
      .catch(() => {
        setItems([])
        setAlerts([])
        setInbound([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const source = mode === 'alerts' ? alerts : items

  const filtered = source.filter((i) => {
    if (platform !== 'all' && i.platform !== platform) return false
    if (search) {
      return i.productId.toLowerCase().includes(search.toLowerCase())
    }
    return true
  })

  const outOfStock = items.filter((i) => i.status === 'out_of_stock').length
  const low = items.filter((i) => i.status === 'low').length

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} tracked &middot; {alerts.length} alerts
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Total SKUs Tracked</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{items.length}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <p className="text-xs text-amber-600">Low Stock</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{low}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
            <p className="text-xs text-red-600">Out of Stock</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{outOfStock}</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
            <p className="text-xs text-blue-600">In Transit</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{inbound.filter((s) => s.status === 'in_transit').length}</p>
          </div>
        </div>

        {/* View toggle + filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
          <div className="flex gap-1.5">
            <button
              onClick={() => setMode('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Inventory
            </button>
            <button
              onClick={() => setMode('alerts')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'alerts' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Alerts Only ({alerts.length})
            </button>
            <button
              onClick={() => setMode('inbound')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'inbound' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Inbound ({inbound.length})
            </button>
          </div>
          <input
            type="text"
            placeholder="Search by product ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'shopify', 'amazon', 'tiktok', 'shopee', 'walmart'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  platform === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Inbound shipments view */}
        {mode === 'inbound' && !loading && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-6">
            {inbound.length === 0 ? (
              <div className="py-10 text-center text-gray-400">No inbound shipments</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="py-3 px-4 text-left font-medium text-gray-500">Shipment ID</th>
                    <th className="py-3 px-4 text-left font-medium text-gray-500">Platform</th>
                    <th className="py-3 px-4 text-right font-medium text-gray-500">Shipped</th>
                    <th className="py-3 px-4 text-right font-medium text-gray-500">Received</th>
                    <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
                    <th className="py-3 px-4 text-right font-medium text-gray-500">ETA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inbound.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-gray-700">{s.shipmentId.slice(0, 12)}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PLATFORM_BADGE[s.platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {s.platform}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-gray-900">{s.quantityShipped}</td>
                      <td className="py-3 px-4 text-right text-gray-500">{s.quantityReceived}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                          s.status === 'in_transit' ? 'bg-blue-50 text-blue-700' :
                          s.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' :
                          s.status === 'receiving' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {s.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-xs text-gray-400">
                        {s.estimatedArrival ? new Date(s.estimatedArrival).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading inventory...</div>
        ) : mode === 'inbound' ? null : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">{mode === 'alerts' ? 'No alerts' : 'No inventory data'}</p>
            <p className="text-sm text-gray-400 mt-1">Inventory syncs from connected platforms</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Product ID</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Platform</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Quantity</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Threshold</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500">Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-gray-700">{i.productId.slice(0, 8)}...</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PLATFORM_BADGE[i.platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {i.platform}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">{i.quantity}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{i.safetyThreshold ?? '—'}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[i.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {i.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-xs text-gray-400">
                      {i.syncedAt ? new Date(i.syncedAt).toLocaleDateString() : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
