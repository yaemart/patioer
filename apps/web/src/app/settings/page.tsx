'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

interface UserInfo {
  email: string
  tenantId: string
  role: string
  plan: string
}

interface GovernancePrefs {
  priceChangeThreshold: number
  adsBudgetApproval: number
  newListingApproval: boolean
}

const DEFAULT_PREFS: GovernancePrefs = {
  priceChangeThreshold: 15,
  adsBudgetApproval: 500,
  newListingApproval: true,
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [prefs, setPrefs] = useState<GovernancePrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    apiFetch<UserInfo>('/api/v1/auth/me')
      .then(setUser)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))

    apiFetch<GovernancePrefs>('/api/v1/settings/governance')
      .then(setPrefs)
      .catch(() => {})

    apiFetch<{ code: string }>('/api/v1/growth/referral-code')
      .then((data) => setReferralCode(data.code))
      .catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveSuccess(false)
    try {
      await apiFetch('/api/v1/settings/governance', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch {
      setError('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }, [prefs])

  const handleCopyReferral = useCallback(() => {
    if (!referralCode) return
    navigator.clipboard.writeText(referralCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [referralCode])

  const openBillingPortal = useCallback(async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/api/v1/billing/portal-session')
      window.location.href = url
    } catch {
      setError('Failed to open billing portal')
    }
  }, [])

  if (error && !user) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

        {/* Account Information */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Account</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Email</span>
              <p className="font-medium">{user?.email ?? '—'}</p>
            </div>
            <div>
              <span className="text-gray-500">Tenant ID</span>
              <p className="font-mono text-xs">{user?.tenantId ?? '—'}</p>
            </div>
            <div>
              <span className="text-gray-500">Role</span>
              <p className="font-medium capitalize">{user?.role ?? '—'}</p>
            </div>
            <div>
              <span className="text-gray-500">Plan</span>
              <p className="font-medium capitalize">{user?.plan ?? '—'}</p>
            </div>
          </div>
          <button
            onClick={openBillingPortal}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition"
          >
            Manage Subscription
          </button>
        </section>

        {/* Governance Preferences */}
        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Governance Preferences</h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Price Change Threshold: {prefs.priceChangeThreshold}%
              </label>
              <input
                type="range"
                min={5}
                max={30}
                step={1}
                value={prefs.priceChangeThreshold}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, priceChangeThreshold: Number(e.target.value) }))
                }
                className="w-full accent-indigo-600"
              />
              <p className="text-xs text-gray-500 mt-1">
                Price changes above this threshold require manual approval.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ads Budget Approval Threshold: ${prefs.adsBudgetApproval}
              </label>
              <input
                type="range"
                min={100}
                max={2000}
                step={50}
                value={prefs.adsBudgetApproval}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, adsBudgetApproval: Number(e.target.value) }))
                }
                className="w-full accent-indigo-600"
              />
              <p className="text-xs text-gray-500 mt-1">
                Daily ad budget changes above this amount require approval.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="newListingApproval"
                checked={prefs.newListingApproval}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, newListingApproval: e.target.checked }))
                }
                className="h-4 w-4 accent-indigo-600"
              />
              <label htmlFor="newListingApproval" className="text-sm text-gray-700">
                Require approval for new product listings
              </label>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving…' : 'Save Preferences'}
            </button>
            {saveSuccess && (
              <span className="text-sm text-green-600">Saved!</span>
            )}
          </div>
        </section>

        {/* Referral Code */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Referral Program</h2>
          <p className="text-sm text-gray-600 mb-3">
            Share your referral code to give friends 30 days of extended trial.
            You&apos;ll receive a 20% discount when they become a paying customer.
          </p>
          {referralCode ? (
            <div className="flex items-center gap-3">
              <code className="px-3 py-2 bg-gray-100 rounded font-mono text-sm tracking-wider">
                {referralCode}
              </code>
              <button
                onClick={handleCopyReferral}
                className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 transition"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Referral code not available yet.</p>
          )}
        </section>

        {error && user && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
    </main>
  )
}
