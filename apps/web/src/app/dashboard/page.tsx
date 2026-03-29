'use client'

import { useEffect, useState } from 'react'
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export default function DashboardPage() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      apiFetch<UserInfo>('/api/v1/auth/me'),
      apiFetch<DashboardSummary>('/api/v1/dashboard/summary'),
    ])
      .then(([userData, summaryData]) => {
        setUser(userData)
        setSummary(summaryData)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
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
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {user.email} &middot; {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} Plan
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardCard
            title="Active Agents"
            value={`${summary.agents.active} / ${summary.agents.limit}`}
            description={`Configured ${summary.agents.total} total, ${summary.agents.recentlyActive ? 'recent activity detected' : 'no recent activity'}`}
          />
          <DashboardCard
            title="Platforms"
            value={`${summary.platforms.connected} / ${summary.platforms.limit}`}
            description={summary.platforms.connected > 0 ? 'Connected platform credentials detected' : 'Connect your first platform'}
          />
          <DashboardCard
            title="Monthly Usage"
            value={`${formatUsd(summary.billing.usedUsd)} / ${formatUsd(summary.billing.budgetUsd)}`}
            description={summary.billing.isOverBudget ? 'Over budget, review recent usage' : `${formatUsd(summary.billing.remainingUsd)} remaining this month`}
          />
        </div>

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Operational Snapshot</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatusStat
              label="Pending Approvals"
              value={String(summary.approvals.pending)}
              hint={summary.approvals.pending > 0 ? 'Human review needed' : 'Approval queue is clear'}
            />
            <StatusStat
              label="Onboarding"
              value={summary.onboarding.completed ? 'Complete' : `Step ${summary.onboarding.currentStep}/7`}
              hint={summary.onboarding.healthCheckPassed ? 'Health check passed' : 'Health check pending'}
            />
            <StatusStat
              label="Last Agent Event"
              value={summary.agents.lastEventAt ? new Date(summary.agents.lastEventAt).toLocaleString() : 'No events yet'}
              hint={summary.agents.recentlyActive ? 'Agents active in last 24h' : 'No activity in last 24h'}
            />
            <StatusStat
              label="Plan"
              value={user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
              hint={`Tenant ${summary.tenantId}`}
            />
          </dl>
        </div>

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="/onboarding"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Complete Onboarding
            </a>
            <a
              href="/onboarding"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors"
            >
              View Onboarding Status
            </a>
            <a
              href="/clipmart"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors"
            >
              Browse ClipMart
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Tenant ID: {user.tenantId}
        </p>
      </div>
    </main>
  )
}

function DashboardCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{description}</p>
    </div>
  )
}

function StatusStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-900">{value}</dd>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
    </div>
  )
}
