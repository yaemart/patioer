'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface UserInfo {
  email: string
  tenantId: string
  role: string
  plan: string
}

interface DashboardSummary {
  tenantId: string
  plan: 'starter' | 'growth' | 'scale'
  agents: {
    active: number
    total: number
    limit: number
    recentlyActive: boolean
    lastEventAt: string | null
  }
  platforms: {
    connected: number
    limit: number
  }
  billing: {
    usedUsd: number
    budgetUsd: number
    remainingUsd: number
    isOverBudget: boolean
  }
  approvals: {
    pending: number
  }
  onboarding: {
    currentStep: number
    completed: boolean
    healthCheckPassed: boolean
  }
}

interface AlertItem {
  id: string
  severity: string
  title: string
  platform: string
  createdAt: string | null
}

interface AlertsResponse {
  totalActive: number
  alerts: AlertItem[]
}

interface AgentEvent {
  id: string
  agentId: string
  action: string
  createdAt: string
}

interface AgentEventsResponse {
  events: AgentEvent[]
  limit: number
  offset: number
}

interface AgentOutcomes {
  pipelineRuns: number
  totalDecisions: number
  totalExecuted: number
  totalApprovals: number
  totalBlocked: number
  totalDegraded: number
  avgConfidence: number
  autoExecuteRate: number
  approvalRate: number
}

interface ProfitOverview {
  range: string
  grossRevenue: number
  netRevenue: number
  cogs: number
  platformFees: number
  shippingCosts: number
  adSpend: number
  refundAmount: number
  contributionMargin: number
  tacos: number | null
  unitsSold: number
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function DashboardPage() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null)
  const [recentEvents, setRecentEvents] = useState<AgentEvent[]>([])
  const [profit, setProfit] = useState<ProfitOverview | null>(null)
  const [profitRange, setProfitRange] = useState<'7d' | '30d' | '90d'>('7d')
  const [outcomes, setOutcomes] = useState<AgentOutcomes | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      apiFetch<UserInfo>('/api/v1/auth/me'),
      apiFetch<DashboardSummary>('/api/v1/dashboard/summary'),
      apiFetch<AlertsResponse>('/api/v1/console/alerts').catch(() => null),
      apiFetch<AgentEventsResponse>('/api/v1/agent-events?limit=10').catch(() => ({ events: [], limit: 10, offset: 0 })),
    ])
      .then(([userData, summaryData, alertsData, eventsData]) => {
        setUser(userData)
        setSummary(summaryData)
        setAlerts(alertsData)
        setRecentEvents(Array.isArray(eventsData.events) ? eventsData.events : [])
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [])

  useEffect(() => {
    apiFetch<ProfitOverview>(`/api/v1/dashboard/overview?range=${profitRange}`)
      .then(setProfit)
      .catch(() => setProfit(null))
  }, [profitRange])

  useEffect(() => {
    apiFetch<AgentOutcomes>('/api/v1/dashboard/agent-outcomes')
      .then(setOutcomes)
      .catch(() => setOutcomes(null))
  }, [])

  if (error) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Authentication Required</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <a
            href="/login"
            className="inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Sign In
          </a>
        </div>
      </main>
    )
  }

  if (!user || !summary) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </main>
    )
  }

  const pendingCount = summary.approvals.pending

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              {user.email} &middot; {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} Plan
            </p>
          </div>
          {pendingCount > 0 && (
            <Link
              href="/approvals"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 transition-colors"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
              Pending Approvals
            </Link>
          )}
        </div>

        {/* Onboarding banner */}
        {!summary.onboarding.completed && (
          <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-800">
                Complete your setup — Step {summary.onboarding.currentStep} of 7
              </p>
              <p className="text-xs text-indigo-600 mt-0.5">
                {summary.onboarding.healthCheckPassed ? 'Health check passed' : 'Health check pending'}
              </p>
            </div>
            <a
              href="/onboarding"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Continue Setup
            </a>
          </div>
        )}

        {/* KPI Cards Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <KpiCard
            label="Active Agents"
            value={`${summary.agents.active} / ${summary.agents.limit}`}
            sub={`${summary.agents.total} configured`}
            accent={summary.agents.recentlyActive ? 'green' : 'gray'}
          />
          <KpiCard
            label="Platforms"
            value={`${summary.platforms.connected}`}
            sub={`${summary.platforms.limit} max`}
            accent={summary.platforms.connected > 0 ? 'green' : 'gray'}
          />
          <KpiCard
            label="Monthly Usage"
            value={formatUsd(summary.billing.usedUsd)}
            sub={`${formatUsd(summary.billing.remainingUsd)} remaining`}
            accent={summary.billing.isOverBudget ? 'red' : 'green'}
          />
          <KpiCard
            label="Alerts"
            value={String(alerts?.totalActive ?? 0)}
            sub="active issues"
            accent={(alerts?.totalActive ?? 0) > 0 ? 'amber' : 'green'}
          />
        </div>

        {/* Profit Cockpit */}
        {profit && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Profit Cockpit</h2>
              <div className="flex gap-1">
                {(['7d', '30d', '90d'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setProfitRange(r)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      profitRange === r
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <ProfitMetric label="Gross Revenue" value={formatUsd(profit.grossRevenue)} color="text-gray-900" />
              <ProfitMetric label="Net Revenue" value={formatUsd(profit.netRevenue)} color="text-gray-900" />
              <ProfitMetric label="Contribution Margin" value={formatUsd(profit.contributionMargin)} color={profit.contributionMargin >= 0 ? 'text-green-600' : 'text-red-600'} />
              <ProfitMetric label="Ad Spend" value={formatUsd(profit.adSpend)} color="text-amber-600" />
              <ProfitMetric label="TACoS" value={profit.tacos !== null ? `${(profit.tacos * 100).toFixed(1)}%` : '—'} color="text-gray-900" />
              <ProfitMetric label="Units Sold" value={profit.unitsSold.toLocaleString()} color="text-gray-900" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ProfitMetric label="COGS" value={formatUsd(profit.cogs)} color="text-gray-600" small />
              <ProfitMetric label="Platform Fees" value={formatUsd(profit.platformFees)} color="text-gray-600" small />
              <ProfitMetric label="Shipping" value={formatUsd(profit.shippingCosts)} color="text-gray-600" small />
              <ProfitMetric label="Refunds" value={formatUsd(profit.refundAmount)} color={profit.refundAmount > 0 ? 'text-red-500' : 'text-gray-600'} small />
            </div>
          </div>
        )}

        {/* Two-column layout: Activity + Alerts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Agent Activity */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Recent Agent Activity</h2>
              <span className="text-xs text-gray-400">
                {summary.agents.lastEventAt ? `Last: ${timeAgo(summary.agents.lastEventAt)}` : 'No activity'}
              </span>
            </div>
            {recentEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No recent events</p>
            ) : (
              <ul className="space-y-2">
                {recentEvents.slice(0, 8).map((evt) => (
                  <li key={evt.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                      <span className="text-xs text-gray-700 truncate">{evt.action}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                      {timeAgo(evt.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Alerts */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Active Alerts</h2>
            {!alerts || alerts.alerts.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No active alerts</p>
            ) : (
              <ul className="space-y-2">
                {alerts.alerts.slice(0, 8).map((alert) => (
                  <li key={alert.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${
                        alert.severity === 'critical' ? 'bg-red-500'
                          : alert.severity === 'warning' ? 'bg-amber-400'
                            : 'bg-blue-400'
                      }`} />
                      <span className="text-xs text-gray-700 truncate">{alert.title}</span>
                    </div>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 shrink-0 ml-2">
                      {alert.platform}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Agent Outcomes */}
        {outcomes && outcomes.pipelineRuns > 0 && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Agent Decision Outcomes</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Pipeline Runs</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{outcomes.pipelineRuns}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Total Decisions</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{outcomes.totalDecisions}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide">Auto-Execute Rate</p>
                <p className="text-lg font-bold text-emerald-700 mt-0.5">{(outcomes.autoExecuteRate * 100).toFixed(1)}%</p>
              </div>
              <div className="rounded-lg bg-indigo-50 px-3 py-2">
                <p className="text-[10px] font-medium text-indigo-600 uppercase tracking-wide">Avg Confidence</p>
                <p className="text-lg font-bold text-indigo-700 mt-0.5">{(outcomes.avgConfidence * 100).toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>Executed: {outcomes.totalExecuted}</span>
              <span>Approvals: {outcomes.totalApprovals}</span>
              <span>Blocked: {outcomes.totalBlocked}</span>
              <span>Degraded: {outcomes.totalDegraded}</span>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/approvals" className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 transition-colors">
              Review Approvals
            </Link>
            <Link href="/agents" className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors">
              Agent Team
            </Link>
            <Link href="/clipmart" className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors">
              Browse ClipMart
            </Link>
            <Link href="/settings" className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

function ProfitMetric({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className={`rounded-lg bg-gray-50 px-3 ${small ? 'py-2' : 'py-3'}`}>
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`${small ? 'text-sm' : 'text-lg'} font-bold ${color} mt-0.5`}>{value}</p>
    </div>
  )
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: 'green' | 'red' | 'amber' | 'gray' }) {
  const dotColor = {
    green: 'bg-green-400',
    red: 'bg-red-400',
    amber: 'bg-amber-400',
    gray: 'bg-gray-300',
  }[accent]

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </div>
  )
}
