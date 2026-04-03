'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface GovernancePrefs {
  priceChangeThreshold: number
  adsBudgetApproval: number
  newListingApproval: boolean
  humanInLoopAgents: string[]
}

const DEFAULT_PREFS: GovernancePrefs = {
  priceChangeThreshold: 15,
  adsBudgetApproval: 500,
  newListingApproval: true,
  humanInLoopAgents: [],
}

const AGENT_TYPES = [
  { id: 'price-sentinel', label: 'Price Sentinel' },
  { id: 'ads-optimizer', label: 'Ads Optimizer' },
  { id: 'inventory-guard', label: 'Inventory Guard' },
  { id: 'product-scout', label: 'Product Scout' },
  { id: 'support-relay', label: 'Support Relay' },
  { id: 'content-writer', label: 'Content Writer' },
  { id: 'market-intel', label: 'Market Intel' },
  { id: 'finance-agent', label: 'Finance Agent' },
  { id: 'ceo-agent', label: 'CEO Agent' },
  { id: 'customer-success', label: 'Customer Success' },
] as const

export default function GovernancePage() {
  const [prefs, setPrefs] = useState<GovernancePrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<GovernancePrefs>('/api/v1/settings/governance')
      .then((data) =>
        setPrefs({
          ...DEFAULT_PREFS,
          ...data,
          humanInLoopAgents: Array.isArray(data.humanInLoopAgents) ? data.humanInLoopAgents : [],
        }),
      )
      .catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveSuccess(false)
    setError(null)
    try {
      await apiFetch('/api/v1/settings/governance', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch {
      setError('Failed to save governance settings')
    } finally {
      setSaving(false)
    }
  }, [prefs])

  function toggleHumanInLoop(agentType: string) {
    setPrefs((p) => {
      const set = new Set(p.humanInLoopAgents)
      if (set.has(agentType)) {
        set.delete(agentType)
      } else {
        set.add(agentType)
      }
      return { ...p, humanInLoopAgents: [...set] }
    })
  }

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

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Governance Preferences</h1>

        {/* Price Change Threshold */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Price Change Threshold</h2>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={prefs.priceChangeThreshold}
              onChange={(e) => setPrefs((p) => ({ ...p, priceChangeThreshold: Number(e.target.value) }))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-12 text-right text-sm font-bold text-indigo-600">
              {prefs.priceChangeThreshold}%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Price changes above this percentage require manual approval.
          </p>
        </section>

        {/* Ads Budget Approval */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Ads Budget Approval Threshold</h2>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={100}
              max={2000}
              step={50}
              value={prefs.adsBudgetApproval}
              onChange={(e) => setPrefs((p) => ({ ...p, adsBudgetApproval: Number(e.target.value) }))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-16 text-right text-sm font-bold text-indigo-600">
              ${prefs.adsBudgetApproval}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Daily ad budget proposals above this amount require approval before platform execution.
          </p>
        </section>

        {/* New Listing Approval */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">New Listing Approval</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.newListingApproval}
              onChange={(e) => setPrefs((p) => ({ ...p, newListingApproval: e.target.checked }))}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            <span className="text-sm text-gray-700">
              Require approval for new product listings and flagged items
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-2">
            When enabled, Product Scout will route flagged items through the Approval Center instead of auto-creating tickets.
          </p>
        </section>

        {/* Human-in-Loop Agents */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Human-in-Loop Agents</h2>
          <p className="text-xs text-gray-500 mb-4">
            Selected agent types will route ALL actions through the Approval Center before execution.
            Use this for agents you want to closely supervise.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AGENT_TYPES.map((at) => {
              const checked = prefs.humanInLoopAgents.includes(at.id)
              return (
                <label
                  key={at.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                    checked
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleHumanInLoop(at.id)}
                    className="h-4 w-4 rounded accent-indigo-600"
                  />
                  <span className={`text-sm font-medium ${checked ? 'text-indigo-700' : 'text-gray-700'}`}>
                    {at.label}
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Governance Settings'}
          </button>
          {saveSuccess && <span className="text-sm text-emerald-600">Saved successfully</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </main>
  )
}
