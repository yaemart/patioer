'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Campaign {
  id: string
  platform: string
  platformCampaignId: string
  name: string
  status: string
  dailyBudget: string | null
  totalSpend: string | null
  roas: string | null
  syncedAt: string | null
  createdAt: string
}

interface Keyword {
  id: string
  platformKeywordId: string
  keywordText: string
  matchType: string
  bid: string | null
  status: string
  impressions: number | null
  clicks: number | null
  spend: string | null
  conversions: number | null
}

interface SearchTerm {
  id: string
  searchTerm: string
  impressions: number | null
  clicks: number | null
  spend: string | null
  conversions: number | null
  reportDate: string
}

interface MetricDay {
  date: string
  impressions: number | null
  clicks: number | null
  spend: string | null
  sales: string | null
  acos: string | null
  roas: string | null
}

const PLATFORMS = ['all', 'shopify', 'amazon', 'tiktok', 'shopee', 'walmart'] as const

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-amber-50 text-amber-700',
  ended: 'bg-gray-100 text-gray-500',
  enabled: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-gray-100 text-gray-500',
}

const PLATFORM_BADGE: Record<string, string> = {
  shopify: 'bg-green-50 text-green-700 border-green-200',
  amazon: 'bg-orange-50 text-orange-700 border-orange-200',
  tiktok: 'bg-gray-900 text-white border-gray-700',
  shopee: 'bg-red-50 text-red-700 border-red-200',
  walmart: 'bg-blue-50 text-blue-700 border-blue-200',
}

const MATCH_BADGE: Record<string, string> = {
  broad: 'bg-purple-50 text-purple-700',
  phrase: 'bg-blue-50 text-blue-700',
  exact: 'bg-emerald-50 text-emerald-700',
}

function money(v: string | null | number): string {
  if (v === null || v === undefined) return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function num(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString()
}

type ViewMode = 'campaigns' | 'keywords' | 'search-terms'

export default function AdsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [performance, setPerformance] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [view, setView] = useState<ViewMode>('campaigns')
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([])
  const [metrics, setMetrics] = useState<MetricDay[]>([])
  const [drillLoading, setDrillLoading] = useState(false)

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ campaigns: Campaign[] }>('/api/v1/ads/campaigns'),
      apiFetch<{ items: Campaign[] }>('/api/v1/ads/performance'),
    ])
      .then(([c, p]) => {
        setCampaigns(c.campaigns)
        setPerformance(p.items)
      })
      .catch(() => {
        setCampaigns([])
        setPerformance([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const drillIntoCampaign = useCallback((camp: Campaign) => {
    setSelectedCampaign(camp)
    setView('keywords')
    setDrillLoading(true)
    Promise.all([
      apiFetch<{ keywords: Keyword[] }>(`/api/v1/ads/keywords?campaignId=${camp.id}`),
      apiFetch<{ searchTerms: SearchTerm[] }>(`/api/v1/ads/search-terms?campaignId=${camp.id}`),
      apiFetch<{ metrics: MetricDay[] }>(`/api/v1/ads/metrics-daily?campaignId=${camp.id}`),
    ])
      .then(([kw, st, m]) => {
        setKeywords(kw.keywords)
        setSearchTerms(st.searchTerms)
        setMetrics(m.metrics)
      })
      .catch(() => {
        setKeywords([])
        setSearchTerms([])
        setMetrics([])
      })
      .finally(() => setDrillLoading(false))
  }, [])

  const goBack = useCallback(() => {
    if (view === 'search-terms') setView('keywords')
    else { setView('campaigns'); setSelectedCampaign(null) }
  }, [view])

  const filtered = campaigns.filter((c) => {
    if (platform !== 'all' && c.platform !== platform) return false
    if (search) {
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.platformCampaignId.toLowerCase().includes(q)
    }
    return true
  })

  const totalSpend = performance.reduce((s, p) => s + (p.totalSpend ? parseFloat(p.totalSpend) : 0), 0)
  const activeCt = campaigns.filter((c) => c.status === 'active').length
  const avgRoas = performance.length > 0
    ? (performance.reduce((s, p) => s + (p.roas ? parseFloat(p.roas) : 0), 0) / performance.length).toFixed(2)
    : null

  const maxSpend = metrics.length > 0 ? Math.max(...metrics.map((m) => parseFloat(m.spend ?? '0'))) : 1

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        {/* Header + Breadcrumb */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <button onClick={() => { setView('campaigns'); setSelectedCampaign(null) }} className="hover:text-indigo-600">
              Advertising
            </button>
            {selectedCampaign && (
              <>
                <span>/</span>
                <button onClick={() => setView('keywords')} className="hover:text-indigo-600 truncate max-w-[200px]">
                  {selectedCampaign.name}
                </button>
                {view === 'search-terms' && <><span>/</span><span>Search Terms</span></>}
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {view === 'campaigns' ? 'Advertising' : selectedCampaign?.name ?? 'Campaign'}
          </h1>
          {view === 'campaigns' && (
            <p className="text-sm text-gray-500 mt-1">
              {activeCt} active campaigns &middot; {money(String(totalSpend))} total spend
            </p>
          )}
        </div>

        {view === 'campaigns' && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Total Campaigns</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{campaigns.length}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Total Spend</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{money(String(totalSpend))}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Avg ROAS</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{avgRoas ? `${avgRoas}x` : '—'}</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
              <input
                type="text"
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex gap-1.5 flex-wrap">
                {PLATFORMS.map((p) => (
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

            {/* Campaign Table */}
            {loading ? (
              <div className="py-10 text-center text-gray-500">Loading campaigns...</div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-gray-500 text-lg">No campaigns found</p>
                <p className="text-sm text-gray-400 mt-1">Campaigns sync from connected platforms</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Campaign</th>
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Platform</th>
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Daily Budget</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Spend</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-gray-50/40 transition-colors cursor-pointer"
                        onClick={() => drillIntoCampaign(c)}
                      >
                        <td className="py-3 px-4">
                          <p className="font-medium text-gray-900 truncate max-w-xs">{c.name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{c.platformCampaignId}</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PLATFORM_BADGE[c.platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {c.platform}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700">{money(c.dailyBudget)}</td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900">{money(c.totalSpend)}</td>
                        <td className="py-3 px-4 text-right text-gray-700">
                          {c.roas ? `${parseFloat(c.roas).toFixed(2)}x` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Keywords View */}
        {view === 'keywords' && (
          <>
            <button onClick={goBack} className="mb-4 text-sm text-indigo-600 hover:text-indigo-800">&larr; Back to campaigns</button>

            {/* Mini metrics chart */}
            {metrics.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6">
                <p className="text-xs font-medium text-gray-500 mb-3">Daily Spend Trend</p>
                <div className="flex items-end gap-1 h-16">
                  {metrics.slice().reverse().map((m) => {
                    const h = maxSpend > 0 ? (parseFloat(m.spend ?? '0') / maxSpend) * 100 : 0
                    return (
                      <div key={m.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.date}: ${money(m.spend)}`}>
                        <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${Math.max(h, 2)}%` }} />
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-gray-400">{metrics[metrics.length - 1]?.date}</span>
                  <span className="text-[9px] text-gray-400">{metrics[0]?.date}</span>
                </div>
              </div>
            )}

            {drillLoading ? (
              <div className="py-10 text-center text-gray-500">Loading keywords...</div>
            ) : keywords.length === 0 ? (
              <div className="py-10 text-center text-gray-400">No keywords for this campaign</div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Keyword</th>
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Match</th>
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Bid</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Impressions</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Clicks</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Spend</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Conv.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {keywords.map((kw) => (
                      <tr key={kw.id} className="hover:bg-gray-50/40 transition-colors">
                        <td className="py-3 px-4 font-medium text-gray-900">{kw.keywordText}</td>
                        <td className="py-3 px-4">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${MATCH_BADGE[kw.matchType] ?? 'bg-gray-100 text-gray-600'}`}>
                            {kw.matchType}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[kw.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {kw.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700">{money(kw.bid)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(kw.impressions)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(kw.clicks)}</td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900">{money(kw.spend)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(kw.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Search Terms link */}
            {searchTerms.length > 0 && (
              <button
                onClick={() => setView('search-terms')}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                View {searchTerms.length} Search Terms &rarr;
              </button>
            )}
          </>
        )}

        {/* Search Terms View */}
        {view === 'search-terms' && (
          <>
            <button onClick={goBack} className="mb-4 text-sm text-indigo-600 hover:text-indigo-800">&larr; Back to keywords</button>
            {searchTerms.length === 0 ? (
              <div className="py-10 text-center text-gray-400">No search terms found</div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="py-3 px-4 text-left font-medium text-gray-500">Search Term</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Impressions</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Clicks</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Spend</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Conv.</th>
                      <th className="py-3 px-4 text-right font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {searchTerms.map((st) => (
                      <tr key={st.id} className="hover:bg-gray-50/40 transition-colors">
                        <td className="py-3 px-4 font-medium text-gray-900">{st.searchTerm}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(st.impressions)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(st.clicks)}</td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900">{money(st.spend)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{num(st.conversions)}</td>
                        <td className="py-3 px-4 text-right text-gray-400 text-xs">{st.reportDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
