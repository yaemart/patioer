'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface ServiceCase {
  id: string
  tenantId: string
  platform: string
  caseType: string
  status: string
  subject: string | null
  description: string | null
  amount: string | null
  priority: string | null
  agentResponse: string | null
  assignedTo: string | null
  resolvedAt: string | null
  createdAt: string
}

interface RefundSummary {
  totalRefunds: number
  totalAmount: number
  byStatus: Record<string, { count: number; amount: number }>
  days: number
}

interface SupportThread {
  threadId: string
  subject: string
  status: string
  lastMessageAt: string
  messageCount: number
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  escalated: 'bg-red-50 text-red-700',
  pending_response: 'bg-amber-50 text-amber-700',
}

const TYPE_ICONS: Record<string, string> = {
  refund: '\uD83D\uDCB8',
  return: '\uD83D\uDCE6',
  inquiry: '\uD83D\uDCAC',
  complaint: '\u26A0\uFE0F',
  feedback: '\uD83D\uDCDD',
}

type TabView = 'cases' | 'refunds' | 'threads'

function money(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ServicePage() {
  const [cases, setCases] = useState<ServiceCase[]>([])
  const [refundSummary, setRefundSummary] = useState<RefundSummary | null>(null)
  const [threads, setThreads] = useState<SupportThread[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [tab, setTab] = useState<TabView>('cases')

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ cases: ServiceCase[] }>('/api/v1/service/cases'),
      apiFetch<RefundSummary>('/api/v1/service/refund-summary'),
      apiFetch<{ threads: SupportThread[] }>('/api/v1/service/threads'),
    ])
      .then(([c, r, t]) => {
        setCases(c.cases)
        setRefundSummary(r)
        setThreads(t.threads)
      })
      .catch(() => {
        setCases([])
        setRefundSummary(null)
        setThreads([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = filter === 'all' ? cases : cases.filter((c) => c.status === filter)
  const openCount = cases.filter((c) => c.status === 'open' || c.status === 'in_progress').length
  const escalatedCount = cases.filter((c) => c.status === 'escalated').length
  const totalRefundAmt = cases
    .filter((c) => c.caseType === 'refund')
    .reduce((s, c) => s + Number(c.amount ?? 0), 0)

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Service Center</h1>
          <p className="text-sm text-gray-500 mt-1">
            {cases.length} total cases &middot; {openCount} open &middot; {escalatedCount} escalated
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Total Cases</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{cases.length}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <p className="text-xs text-amber-600">Open</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{openCount}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
            <p className="text-xs text-red-600">Escalated</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{escalatedCount}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <p className="text-xs text-emerald-600">Resolved</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">
              {cases.filter((c) => c.status === 'resolved').length}
            </p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <p className="text-xs text-indigo-600">Refund Total</p>
            <p className="text-2xl font-bold text-indigo-700 mt-1">{money(totalRefundAmt)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5 border-b border-gray-200 pb-3">
          {(['cases', 'refunds', 'threads'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t === 'refunds' ? 'Refund Summary' : t === 'threads' ? 'Messages' : t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading...</div>
        ) : (
          <>
            {/* Cases Tab */}
            {tab === 'cases' && (
              <>
                <div className="flex gap-1.5 mb-5 flex-wrap">
                  {['all', 'open', 'in_progress', 'escalated', 'resolved'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilter(s)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                        filter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                {filtered.length === 0 ? (
                  <div className="py-20 text-center">
                    <p className="text-gray-500 text-lg">No cases found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filtered.map((c) => (
                      <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{TYPE_ICONS[c.caseType] ?? '\uD83D\uDCCB'}</span>
                            <div>
                              <h3 className="text-sm font-semibold text-gray-900">
                                {c.subject || `${c.caseType} case`}
                              </h3>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {c.platform} &middot; {new Date(c.createdAt).toLocaleDateString()}
                                {c.amount && ` · ${money(Number(c.amount))}`}
                              </p>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {c.status.replace('_', ' ')}
                          </span>
                        </div>
                        {c.description && <p className="mt-2 text-xs text-gray-600 line-clamp-2">{c.description}</p>}
                        {c.agentResponse && (
                          <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2">
                            <p className="text-[10px] font-medium text-blue-700 mb-0.5">Agent Response</p>
                            <p className="text-xs text-blue-800 line-clamp-2">{c.agentResponse}</p>
                          </div>
                        )}
                        {c.priority && (
                          <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            c.priority === 'high' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'
                          }`}>
                            {c.priority} priority
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Refund Summary Tab */}
            {tab === 'refunds' && (
              <div className="space-y-4">
                {refundSummary ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <p className="text-xs text-gray-500">Refund Cases ({refundSummary.days}d)</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{refundSummary.totalRefunds}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <p className="text-xs text-gray-500">Total Refund Amount</p>
                        <p className="text-2xl font-bold text-red-600 mt-1">{money(refundSummary.totalAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <p className="text-xs text-gray-500">Avg per Case</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">
                          {refundSummary.totalRefunds > 0
                            ? money(refundSummary.totalAmount / refundSummary.totalRefunds)
                            : '—'}
                        </p>
                      </div>
                    </div>
                    {Object.keys(refundSummary.byStatus).length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <p className="text-xs font-medium text-gray-500 mb-3">By Status</p>
                        <div className="space-y-2">
                          {Object.entries(refundSummary.byStatus).map(([status, data]) => (
                            <div key={status} className="flex items-center justify-between">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600'}`}>
                                {status}
                              </span>
                              <span className="text-sm text-gray-700">
                                {data.count} cases &middot; {money(data.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center text-gray-400">No refund data available</div>
                )}
              </div>
            )}

            {/* Threads Tab */}
            {tab === 'threads' && (
              <div className="space-y-3">
                {threads.length === 0 ? (
                  <div className="py-10 text-center text-gray-400">No message threads</div>
                ) : (
                  threads.map((t) => (
                    <div key={t.threadId} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">{t.subject}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {t.messageCount} messages &middot; Last: {new Date(t.lastMessageAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
