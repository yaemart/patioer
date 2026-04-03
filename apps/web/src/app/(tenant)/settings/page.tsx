'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface UserInfo {
  email: string
  tenantId: string
  role: string
  plan: string
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<UserInfo>('/api/v1/auth/me')
      .then(setUser)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))

    apiFetch<{ code: string }>('/api/v1/growth/referral-code')
      .then((data) => setReferralCode(data.code))
      .catch(() => {})
  }, [])

  const handleCopyReferral = useCallback(() => {
    if (!referralCode) return
    navigator.clipboard.writeText(referralCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [referralCode])

  if (error && !user) {
    return (
      <main className="py-8 px-6">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  const SUB_PAGES = [
    { label: 'Governance', href: '/settings/governance', description: 'Agent approval rules, price thresholds, human-in-loop config', icon: '🛡️' },
    { label: 'Billing & Usage', href: '/settings/billing', description: 'Plan details, usage tracking, Stripe portal', icon: '💳' },
    { label: 'SOP Scenarios', href: '/settings/sop', description: 'Standard Operating Procedures — define agent strategy for different business contexts', icon: '📋' },
  ]

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        {/* Account */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Account</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] text-gray-400">Email</p>
              <p className="font-medium text-gray-900">{user?.email ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Tenant ID</p>
              <p className="font-mono text-xs text-gray-700">{user?.tenantId ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Role</p>
              <p className="font-medium capitalize text-gray-900">{user?.role ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Plan</p>
              <p className="font-medium capitalize text-gray-900">{user?.plan ?? '—'}</p>
            </div>
          </div>
        </section>

        {/* Sub-page links */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          {SUB_PAGES.map((sp) => (
            <Link
              key={sp.href}
              href={sp.href}
              className="rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{sp.icon}</span>
                <h3 className="text-sm font-semibold text-gray-900">{sp.label}</h3>
              </div>
              <p className="text-xs text-gray-500">{sp.description}</p>
            </Link>
          ))}
        </div>

        {/* Referral */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Referral Program</h2>
          <p className="text-xs text-gray-500 mb-3">
            Share your code: 30-day extended trial for friends, 20% discount for you.
          </p>
          {referralCode ? (
            <div className="flex items-center gap-3">
              <code className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm tracking-wider text-gray-700">
                {referralCode}
              </code>
              <button
                onClick={handleCopyReferral}
                className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Referral code not available.</p>
          )}
        </section>
      </div>
    </main>
  )
}
