'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Approval {
  id: string
  tenantId: string
  agentId: string
  action: string
  payload: Record<string, unknown>
  status: string
  displayTitle: string | null
  displayDescription: string | null
  impactPreview: Record<string, unknown> | null
  rollbackPlan: string | null
  expireAt: string | null
  createdAt: string
  guard?: {
    effect: 'require_approval'
    reason: string
  } | null
  autoApprovable?: boolean
  autoApproveReason?: string | null
  confidence?: number | null
}

interface ApprovalMaturityMetrics {
  decisions: { last24h: number; last7d: number }
  harnessApiErrorRate: number
  pendingApprovals: number
  sop: { activeSopCount: number; activeScenarioCount: number }
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'expired' | 'all'

const STATUS_OPTIONS: StatusFilter[] = ['pending', 'approved', 'rejected', 'expired', 'all']

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
}

function timeRemaining(expireAt: string): string {
  const diff = new Date(expireAt).getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return `${Math.floor(diff / 60000)}m left`
  if (hours < 24) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [maturity, setMaturity] = useState<ApprovalMaturityMetrics | null>(null)
  const [approvalMode, setApprovalMode] = useState<'approval_required' | 'approval_informed'>('approval_required')
  const [modeSaving, setModeSaving] = useState(false)

  useEffect(() => {
    apiFetch<ApprovalMaturityMetrics>('/api/v1/metrics/agents')
      .then(setMaturity)
      .catch(() => {})
    apiFetch<{ approvalMode?: string }>('/api/v1/settings/governance')
      .then((data) => {
        if (data.approvalMode === 'approval_informed') setApprovalMode('approval_informed')
      })
      .catch(() => {})
  }, [])

  async function toggleApprovalMode() {
    const next = approvalMode === 'approval_required' ? 'approval_informed' : 'approval_required'
    setModeSaving(true)
    try {
      await apiFetch('/api/v1/settings/governance', {
        method: 'PUT',
        body: JSON.stringify({ approvalMode: next }),
      })
      setApprovalMode(next)
    } finally {
      setModeSaving(false)
    }
  }

  const fetchApprovals = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    if (actionFilter) params.set('action', actionFilter)
    const qs = params.toString()

    apiFetch<{ approvals: Approval[] }>(`/api/v1/approvals${qs ? `?${qs}` : ''}`)
      .then((data) => setApprovals(data.approvals))
      .catch(() => setApprovals([]))
      .finally(() => {
        setLoading(false)
        setSelected(new Set())
      })
  }, [filter, actionFilter])

  useEffect(() => { fetchApprovals() }, [fetchApprovals])

  async function handleResolve(id: string, resolution: 'approved' | 'rejected') {
    await apiFetch(`/api/v1/approvals/${id}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ status: resolution, resolvedBy: 'seller' }),
    })
    setApprovals((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: resolution } : a)),
    )
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  async function handleBatchResolve(resolution: 'approved' | 'rejected') {
    if (selected.size === 0) return
    setBatchLoading(true)
    try {
      await apiFetch('/api/v1/approvals/batch-resolve', {
        method: 'POST',
        body: JSON.stringify({
          ids: Array.from(selected),
          status: resolution,
          resolvedBy: 'seller',
        }),
      })
      fetchApprovals()
    } finally {
      setBatchLoading(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const pendingIds = approvals.filter((a) => a.status === 'pending').map((a) => a.id)
    if (selected.size === pendingIds.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendingIds))
    }
  }

  const actionTypes = [...new Set(approvals.map((a) => a.action))]
  const pendingCount = approvals.filter((a) => a.status === 'pending').length

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Approval Center</h1>
          <p className="text-sm text-gray-500 mt-1">Review and manage agent proposals</p>
        </div>

        {maturity && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Decisions (24h)</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{maturity.decisions.last24h}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Decisions (7d)</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{maturity.decisions.last7d}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Harness Error Rate</p>
              <p className={`mt-1 text-xl font-bold ${maturity.harnessApiErrorRate > 0.05 ? 'text-red-600' : 'text-emerald-600'}`}>
                {(maturity.harnessApiErrorRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Active SOPs</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{maturity.sop.activeSopCount}</p>
            </div>
          </div>
        )}

        {/* Approval Mode Toggle */}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="flex-1">
            <p className="text-xs font-medium text-gray-900">Approval Mode</p>
            <p className="text-[10px] text-gray-500">
              {approvalMode === 'approval_required'
                ? 'All decisions require manual approval before execution'
                : 'Safe, high-confidence decisions auto-execute with post-hoc notification'}
            </p>
          </div>
          <button
            onClick={toggleApprovalMode}
            disabled={modeSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              approvalMode === 'approval_informed' ? 'bg-indigo-600' : 'bg-gray-300'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                approvalMode === 'approval_informed' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-[10px] font-medium text-gray-700 w-16">
            {approvalMode === 'approval_informed' ? 'Informed' : 'Required'}
          </span>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {actionTypes.length > 1 && (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All actions</option>
              {actionTypes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
        </div>

        {/* Batch actions */}
        {pendingCount > 0 && filter === 'pending' && (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={selected.size === pendingCount && pendingCount > 0}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 text-indigo-600"
              />
              Select all ({pendingCount})
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-xs text-gray-400">|</span>
                <span className="text-xs text-gray-600">{selected.size} selected</span>
                <button
                  onClick={() => handleBatchResolve('approved')}
                  disabled={batchLoading}
                  className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                >
                  Batch Approve
                </button>
                <button
                  onClick={() => handleBatchResolve('rejected')}
                  disabled={batchLoading}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                >
                  Batch Reject
                </button>
              </>
            )}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="py-20 text-center text-gray-500">Loading approvals...</div>
        ) : approvals.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">No {filter === 'all' ? '' : filter} approvals</p>
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  {a.status === 'pending' && (
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="mt-1 rounded border-gray-300 text-indigo-600"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {a.displayTitle ?? a.action}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {a.status}
                      </span>
                      {a.autoApprovable && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700" title={a.autoApproveReason ?? undefined}>
                          Auto-approvable
                        </span>
                      )}
                      {a.expireAt && a.status === 'pending' && (
                        <span className="text-[10px] text-gray-400">{timeRemaining(a.expireAt)}</span>
                      )}
                    </div>

                    {a.displayDescription && (
                      <p className="text-xs text-gray-600 mt-1">{a.displayDescription}</p>
                    )}

                    {typeof a.confidence === 'number' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 shrink-0">Confidence</span>
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              a.confidence >= 0.9 ? 'bg-emerald-500' :
                              a.confidence >= 0.7 ? 'bg-amber-400' : 'bg-red-400'
                            }`}
                            style={{ width: `${Math.min(100, a.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-gray-700 shrink-0">
                          {(a.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}

                    {a.guard?.reason && (
                      <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-violet-700 mb-1">
                          Guard Reason
                        </p>
                        <p className="text-xs text-violet-900">{a.guard.reason}</p>
                      </div>
                    )}

                    <p className="text-[10px] text-gray-400 mt-1">
                      {a.action} &middot; {new Date(a.createdAt).toLocaleString()}
                    </p>

                    {/* Impact Preview */}
                    {a.impactPreview && (
                      <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2">
                        <p className="text-[10px] font-medium text-blue-700 uppercase tracking-wide mb-1">Impact Preview</p>
                        {typeof a.impactPreview === 'string' ? (
                          <p className="text-xs text-blue-800">{a.impactPreview}</p>
                        ) : Object.keys(a.impactPreview).length > 0 ? (
                          <div className="flex flex-wrap gap-3">
                            {Object.entries(a.impactPreview).map(([key, val]) => (
                              <div key={key} className="text-xs">
                                <span className="text-blue-500">{key}:</span>{' '}
                                <span className="text-blue-800 font-medium">{String(val)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Similar Past Decisions */}
                    {Array.isArray(a.payload?.similarPastDecisions) && (a.payload.similarPastDecisions as Array<Record<string, unknown>>).length > 0 && (
                      <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2">
                        <p className="text-[10px] font-medium text-indigo-700 uppercase tracking-wide mb-1">Similar Past Decisions</p>
                        <div className="space-y-1">
                          {(a.payload.similarPastDecisions as Array<Record<string, unknown>>).slice(0, 3).map((past, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-indigo-800">
                              <span className="shrink-0 text-indigo-400">{String(past.date ?? '').slice(0, 10)}</span>
                              <span className="flex-1 truncate">{String(past.action ?? past.summary ?? 'N/A')}</span>
                              {past.outcome != null && (
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  String(past.outcome) === 'success' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {String(past.outcome)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rollback Plan */}
                    {a.rollbackPlan && (
                      <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2">
                        <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-1">Rollback Plan</p>
                        <p className="text-xs text-amber-800">{a.rollbackPlan}</p>
                      </div>
                    )}

                    {/* Raw payload (collapsed) */}
                    <details className="mt-2">
                      <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">Raw payload</summary>
                      <pre className="mt-1 rounded-lg bg-gray-50 p-2 text-[10px] text-gray-500 overflow-x-auto max-h-40">
                        {JSON.stringify(a.payload, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {/* Actions */}
                  {a.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => handleResolve(a.id, 'approved')}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleResolve(a.id, 'rejected')}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
