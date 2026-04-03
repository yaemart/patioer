'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface HealthEvent {
  id: string
  tenantId: string
  platform: string
  eventType: string
  severity: string
  message: string | null
  asin: string | null
  resolvedAt: string | null
  createdAt: string
}

interface HealthSummary {
  total: number
  critical: number
  warning: number
  resolved: number
  events: HealthEvent[]
}

interface AccountSummary {
  overallStatus: string
  openIssues: number
  resolvedLast30d: number
  harnessMetrics: {
    overallStatus: string
    orderDefectRate: number | null
    lateShipmentRate: number | null
    preFullfillmentCancelRate: number | null
    policyViolations: number
    intellectualPropertyComplaints: number
  }
}

interface ListingIssue {
  asin: string
  sku: string | null
  issueType: string
  severity: string
  title: string
  description: string
  detectedAt: string
}

interface BuyBoxEntry {
  asin: string
  sku: string | null
  buyBoxPercentage: number
  isCurrentWinner: boolean
  competitorCount: number
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
}

const STATUS_COLOR: Record<string, string> = {
  healthy: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  at_risk: 'text-amber-600 bg-amber-50 border-amber-200',
  critical: 'text-red-600 bg-red-50 border-red-200',
}

const EVENT_ICONS: Record<string, string> = {
  policy_violation: '\uD83D\uDEAB',
  listing_issue: '\u26A0\uFE0F',
  buybox_lost: '\uD83D\uDCC9',
  account_warning: '\uD83D\uDD14',
  ip_complaint: '\u2696\uFE0F',
  performance_alert: '\uD83D\uDCCA',
}

type TabView = 'events' | 'listing-issues' | 'buybox'

export default function AccountHealthPage() {
  const [data, setData] = useState<HealthSummary | null>(null)
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [listingIssues, setListingIssues] = useState<ListingIssue[]>([])
  const [buyBoxEntries, setBuyBoxEntries] = useState<BuyBoxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [tab, setTab] = useState<TabView>('events')

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<HealthSummary>('/api/v1/account-health'),
      apiFetch<AccountSummary>('/api/v1/account-health/summary'),
      apiFetch<{ issues: ListingIssue[] }>('/api/v1/account-health/listing-issues'),
      apiFetch<{ entries: BuyBoxEntry[] }>('/api/v1/account-health/buybox'),
    ])
      .then(([h, s, li, bb]) => {
        setData(h)
        setSummary(s)
        setListingIssues(li.issues)
        setBuyBoxEntries(bb.entries)
      })
      .catch(() => {
        setData(null)
        setSummary(null)
        setListingIssues([])
        setBuyBoxEntries([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const events = data?.events ?? []
  const filtered = filter === 'all'
    ? events
    : filter === 'unresolved'
      ? events.filter((e) => !e.resolvedAt)
      : events.filter((e) => e.severity === filter)

  const avgBuyBox = buyBoxEntries.length > 0
    ? Math.round(buyBoxEntries.reduce((s, e) => s + e.buyBoxPercentage, 0) / buyBoxEntries.length)
    : null

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Account Health</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor policy violations, listing issues, and Buy Box performance.
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading health data...</div>
        ) : (
          <>
            {/* Health Score Banner */}
            {summary && (
              <div className={`rounded-xl border p-4 mb-6 ${STATUS_COLOR[summary.overallStatus] ?? 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide">Overall Health Status</p>
                    <p className="text-2xl font-bold capitalize mt-1">{summary.overallStatus.replace('_', ' ')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs opacity-70">{summary.openIssues} open issues</p>
                    <p className="text-xs opacity-70">{summary.resolvedLast30d} resolved (30d)</p>
                  </div>
                </div>
                {summary.harnessMetrics && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-white/60 px-3 py-2">
                      <p className="text-[10px] text-gray-500">Order Defect Rate</p>
                      <p className="text-sm font-bold">{summary.harnessMetrics.orderDefectRate ?? '—'}%</p>
                    </div>
                    <div className="rounded-lg bg-white/60 px-3 py-2">
                      <p className="text-[10px] text-gray-500">Late Shipment Rate</p>
                      <p className="text-sm font-bold">{summary.harnessMetrics.lateShipmentRate ?? '—'}%</p>
                    </div>
                    <div className="rounded-lg bg-white/60 px-3 py-2">
                      <p className="text-[10px] text-gray-500">Cancellation Rate</p>
                      <p className="text-sm font-bold">{summary.harnessMetrics.preFullfillmentCancelRate ?? '—'}%</p>
                    </div>
                    <div className="rounded-lg bg-white/60 px-3 py-2">
                      <p className="text-[10px] text-gray-500">Policy Violations</p>
                      <p className="text-sm font-bold">{summary.harnessMetrics.policyViolations}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5 mb-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Total Events</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{data?.total ?? 0}</p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
                <p className="text-xs text-red-600">Critical</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{data?.critical ?? 0}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                <p className="text-xs text-amber-600">Warnings</p>
                <p className="text-2xl font-bold text-amber-700 mt-1">{data?.warning ?? 0}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <p className="text-xs text-emerald-600">Resolved</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{data?.resolved ?? 0}</p>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                <p className="text-xs text-indigo-600">Avg Buy Box</p>
                <p className="text-2xl font-bold text-indigo-700 mt-1">{avgBuyBox !== null ? `${avgBuyBox}%` : '—'}</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-5 border-b border-gray-200 pb-3">
              {(['events', 'listing-issues', 'buybox'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'listing-issues' ? `Listing Issues (${listingIssues.length})` : t === 'buybox' ? `Buy Box (${buyBoxEntries.length})` : 'Events'}
                </button>
              ))}
            </div>

            {/* Events Tab */}
            {tab === 'events' && (
              <>
                <div className="flex gap-1.5 mb-5 flex-wrap">
                  {['all', 'unresolved', 'critical', 'warning', 'info'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                        filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                {filtered.length === 0 ? (
                  <div className="py-10 text-center text-gray-400">No matching events</div>
                ) : (
                  <div className="space-y-3">
                    {filtered.map((e) => (
                      <div
                        key={e.id}
                        className={`rounded-xl border p-4 ${
                          e.resolvedAt ? 'border-gray-200 bg-white opacity-60' :
                          SEVERITY_STYLE[e.severity] ?? 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{EVENT_ICONS[e.eventType] ?? '\uD83D\uDCCB'}</span>
                            <div>
                              <h3 className="text-sm font-semibold text-gray-900">{e.eventType.replace(/_/g, ' ')}</h3>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {e.platform}{e.asin && ` · ASIN: ${e.asin}`} · {new Date(e.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${SEVERITY_STYLE[e.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                              {e.severity}
                            </span>
                            {e.resolvedAt && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Resolved</span>
                            )}
                          </div>
                        </div>
                        {e.message && <p className="mt-2 text-xs text-gray-600">{e.message}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Listing Issues Tab */}
            {tab === 'listing-issues' && (
              listingIssues.length === 0 ? (
                <div className="py-10 text-center text-gray-400">No listing issues detected</div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="py-3 px-4 text-left font-medium text-gray-500">ASIN</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-500">Issue</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-500">Severity</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-500">Detected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {listingIssues.map((li, i) => (
                        <tr key={i} className="hover:bg-gray-50/40">
                          <td className="py-3 px-4">
                            <p className="font-medium text-gray-900">{li.asin}</p>
                            {li.sku && <p className="text-[10px] text-gray-400">{li.sku}</p>}
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-gray-900">{li.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{li.description}</p>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${SEVERITY_STYLE[li.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                              {li.severity}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-500">{new Date(li.detectedAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Buy Box Tab */}
            {tab === 'buybox' && (
              buyBoxEntries.length === 0 ? (
                <div className="py-10 text-center text-gray-400">No Buy Box data available</div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="py-3 px-4 text-left font-medium text-gray-500">ASIN</th>
                        <th className="py-3 px-4 text-left font-medium text-gray-500">SKU</th>
                        <th className="py-3 px-4 text-right font-medium text-gray-500">Buy Box %</th>
                        <th className="py-3 px-4 text-center font-medium text-gray-500">Winner</th>
                        <th className="py-3 px-4 text-right font-medium text-gray-500">Competitors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {buyBoxEntries.map((bb) => (
                        <tr key={bb.asin} className="hover:bg-gray-50/40">
                          <td className="py-3 px-4 font-medium text-gray-900">{bb.asin}</td>
                          <td className="py-3 px-4 text-gray-600">{bb.sku ?? '—'}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${bb.buyBoxPercentage >= 70 ? 'bg-emerald-500' : bb.buyBoxPercentage >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${bb.buyBoxPercentage}%` }}
                                />
                              </div>
                              <span className="font-medium text-gray-900 w-10 text-right">{bb.buyBoxPercentage}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${bb.isCurrentWinner ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {bb.isCurrentWinner ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-gray-600">{bb.competitorCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </div>
    </main>
  )
}
