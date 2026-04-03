'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface UsageInfo {
  plan: string
  usedUsd: number
  budgetUsd: number
  remainingUsd: number
  isOverBudget: boolean
}

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<UsageInfo>('/api/v1/billing/usage')
      .then(setUsage)
      .catch(() => setUsage(null))
      .finally(() => setLoading(false))
  }, [])

  const openPortal = useCallback(async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/api/v1/billing/portal-session')
      window.location.href = url
    } catch {
      setError('Failed to open Stripe portal. Please try again.')
    }
  }, [])

  const usedPct = usage && usage.budgetUsd > 0
    ? Math.min(Math.round((usage.usedUsd / usage.budgetUsd) * 100), 100)
    : 0

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Settings
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Billing & Usage</h1>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading billing info...</div>
        ) : (
          <>
            {/* Plan card */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Current Plan</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-gray-900 capitalize">
                    {usage?.plan ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Manage your subscription, invoices, and payment methods via Stripe.
                  </p>
                </div>
                <button
                  onClick={openPortal}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Manage Subscription
                </button>
              </div>
            </section>

            {/* Usage */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">This Month&apos;s Usage</h2>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-2xl font-bold text-gray-900">
                  ${(usage?.usedUsd ?? 0).toFixed(2)}
                </span>
                <span className="text-sm text-gray-500">
                  / ${(usage?.budgetUsd ?? 0).toFixed(2)} limit
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden mb-1">
                <div
                  className={`h-full rounded-full transition-all ${
                    usedPct >= 90
                      ? 'bg-red-500'
                      : usedPct >= 70
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <p className="text-right text-[10px] text-gray-400">{usedPct}% consumed</p>
            </section>

            {/* Info */}
            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Billing FAQ</h2>
              <div className="space-y-3 text-xs text-gray-600">
                <div>
                  <p className="font-medium text-gray-700">When am I billed?</p>
                  <p>Usage is calculated monthly and charged at the end of each billing period.</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">What counts as usage?</p>
                  <p>LLM token costs, platform API calls, and agent execution time are metered.</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">How do I upgrade?</p>
                  <p>Click &quot;Manage Subscription&quot; to access the Stripe portal for plan changes.</p>
                </div>
              </div>
            </section>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </main>
  )
}
