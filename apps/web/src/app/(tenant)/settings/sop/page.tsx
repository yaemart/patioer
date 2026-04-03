'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScenarioTemplate {
  id: string
  scenario: string
  scope: string
  platform: string | null
  defaultSopText: string
  defaultGoalContext: Record<string, unknown>
  editableFields: string[]
  lockedFields: string[]
}

interface SopScenario {
  id: string
  scenario: string
  scenarioName: string | null
  platform: string | null
  status: string
  createdAt: string
}

interface ExpandedSop {
  scope: string
  effectiveSopText: string
  goalContext: Record<string, unknown>
  systemPrompt: string | null
  governance: Record<string, unknown>
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCENARIO_META: Record<string, { label: string; icon: string; description: string; color: string }> = {
  launch:    { label: 'Launch',    icon: '🚀', description: 'New product launch: aggressive pricing, rapid growth', color: 'border-blue-300 bg-blue-50' },
  defend:    { label: 'Defend',    icon: '🛡️', description: 'Defend market position: protect margin and rankings', color: 'border-amber-300 bg-amber-50' },
  clearance: { label: 'Clearance', icon: '🏷️', description: 'Clearance / liquidation: accept low margin, move stock', color: 'border-red-300 bg-red-50' },
  daily:     { label: 'Daily Ops', icon: '⚙️', description: 'Steady-state daily operations: balanced defaults', color: 'border-gray-300 bg-gray-50' },
}

const SCOPE_LABELS: Record<string, string> = {
  'price-sentinel': 'Price Sentinel',
  'ads-optimizer': 'Ads Optimizer',
  'inventory-guard': 'Inventory Guard',
  'product-scout': 'Product Scout',
}

const STEP_LABELS = ['Select Scenario', 'Configure Scope', 'Edit Strategy', 'Preview & Save']

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SopPage() {
  const [scenarios, setScenarios] = useState<SopScenario[]>([])
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardStep, setWizardStep] = useState<number | null>(null)

  // Wizard state
  const [selectedScenario, setSelectedScenario] = useState<string>('')
  const [scenarioName, setScenarioName] = useState('')
  const [scopePlatform, setScopePlatform] = useState<string>('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({})
  const [preview, setPreview] = useState<ExpandedSop[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [scenarioRes, templateRes] = await Promise.all([
        apiFetch<{ scenarios: SopScenario[] }>('/api/v1/sop/scenarios'),
        apiFetch<{ templates: ScenarioTemplate[] }>('/api/v1/sop/templates'),
      ])
      setScenarios(scenarioRes.scenarios)
      setTemplates(templateRes.templates)
    } catch {
      setScenarios([])
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Reset wizard
  function startWizard() {
    setWizardStep(0)
    setSelectedScenario('')
    setScenarioName('')
    setScopePlatform('')
    setEffectiveFrom('')
    setEffectiveTo('')
    setOverrides({})
    setPreview([])
    setError(null)
  }

  function closeWizard() { setWizardStep(null) }

  // Step 2 → 3: prepare overrides from templates
  function prepareOverrides() {
    const scenarioTemplates = templates.filter((t) => t.scenario === selectedScenario)
    const initial: Record<string, Record<string, unknown>> = {}
    for (const t of scenarioTemplates) {
      initial[t.scope] = { ...t.defaultGoalContext }
    }
    setOverrides(initial)
  }

  async function runPreview() {
    setPreviewLoading(true)
    setError(null)
    try {
      const result = await apiFetch<{
        scenario: string
        sops: ExpandedSop[]
      }>('/api/v1/sop/scenarios/preview', {
        method: 'POST',
        body: JSON.stringify({
          scenario: selectedScenario,
          tenantOverrides: overrides,
        }),
      })
      setPreview(result.sops)
      setWizardStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  // Step 4: save
  async function saveScenario() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/api/v1/sop/scenarios', {
        method: 'POST',
        body: JSON.stringify({
          scenario: selectedScenario,
          scenarioName: scenarioName || undefined,
          platform: scopePlatform || undefined,
          effectiveFrom: effectiveFrom || undefined,
          effectiveTo: effectiveTo || undefined,
          tenantOverrides: overrides,
        }),
      })
      closeWizard()
      await fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Scenario status actions
  async function setScenarioStatus(id: string, action: 'activate' | 'archive') {
    try {
      await apiFetch(`/api/v1/sop/scenarios/${id}/${action}`, { method: 'POST' })
      await fetchData()
    } catch {
      /* silent */
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (wizardStep !== null) {
    return (
      <main className="py-8 px-6">
        <div className="mx-auto max-w-4xl">
          <button onClick={closeWizard} className="text-sm text-gray-500 hover:text-gray-700 mb-4">
            &larr; Back to SOP Scenarios
          </button>

          {/* Stepper */}
          <div className="flex items-center gap-2 mb-8">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  i <= wizardStep! ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {i + 1}
                </div>
                <span className={`text-sm font-medium ${i <= wizardStep! ? 'text-gray-900' : 'text-gray-400'}`}>
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <div className={`h-px w-8 ${i < wizardStep! ? 'bg-indigo-400' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>

          {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          {/* Step 1: Select Scenario */}
          {wizardStep === 0 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Select a Scenario</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(SCENARIO_META).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedScenario(key)}
                    className={`rounded-xl border-2 p-5 text-left transition-all ${
                      selectedScenario === key
                        ? 'border-indigo-500 ring-2 ring-indigo-200'
                        : `${meta.color} hover:border-indigo-300`
                    }`}
                  >
                    <span className="text-2xl">{meta.icon}</span>
                    <h3 className="mt-2 font-semibold text-gray-900">{meta.label}</h3>
                    <p className="mt-1 text-xs text-gray-600">{meta.description}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  disabled={!selectedScenario}
                  onClick={() => setWizardStep(1)}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Configure Scope */}
          {wizardStep === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Configure Scope</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scenario Name (optional)</label>
                  <input
                    type="text"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    placeholder={`e.g. "Spring Launch 2026"`}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Platform (optional scope)</label>
                  <select
                    value={scopePlatform}
                    onChange={(e) => setScopePlatform(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">All Platforms (global)</option>
                    <option value="amazon">Amazon</option>
                    <option value="shopify">Shopify</option>
                    <option value="tiktok">TikTok Shop</option>
                    <option value="shopee">Shopee</option>
                    <option value="walmart">Walmart</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                    <input
                      type="date"
                      value={effectiveFrom}
                      onChange={(e) => setEffectiveFrom(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Effective To</label>
                    <input
                      type="date"
                      value={effectiveTo}
                      onChange={(e) => setEffectiveTo(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <button onClick={() => setWizardStep(0)} className="text-sm text-gray-500 hover:text-gray-700">Back</button>
                <button
                  onClick={() => { prepareOverrides(); setWizardStep(2) }}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Edit Strategy */}
          {wizardStep === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Edit Agent Strategies</h2>
              <p className="text-sm text-gray-500 mb-6">
                Adjust parameters for each agent. Locked fields (greyed out) are fixed by the scenario template.
              </p>
              {templates.filter((t) => t.scenario === selectedScenario).map((t) => {
                const scopeOverrides = overrides[t.scope] ?? {}
                return (
                  <div key={t.scope} className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">
                      {SCOPE_LABELS[t.scope] ?? t.scope}
                    </h3>
                    <p className="text-xs text-gray-500 mb-3 whitespace-pre-wrap">{t.defaultSopText}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Object.entries(t.defaultGoalContext).map(([key, defaultVal]) => {
                        const isLocked = t.lockedFields.includes(key)
                        const value = scopeOverrides[key] ?? defaultVal
                        return (
                          <div key={key}>
                            <label className={`block text-xs font-medium mb-1 ${isLocked ? 'text-gray-400' : 'text-gray-700'}`}>
                              {key} {isLocked && '(locked)'}
                            </label>
                            {typeof defaultVal === 'boolean' ? (
                              <input
                                type="checkbox"
                                disabled={isLocked}
                                checked={!!value}
                                onChange={(e) => {
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [t.scope]: { ...prev[t.scope], [key]: e.target.checked },
                                  }))
                                }}
                                className="h-4 w-4 rounded accent-indigo-600"
                              />
                            ) : typeof defaultVal === 'number' ? (
                              <input
                                type="number"
                                disabled={isLocked}
                                value={value as number}
                                onChange={(e) => {
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [t.scope]: { ...prev[t.scope], [key]: Number(e.target.value) },
                                  }))
                                }}
                                className={`w-full rounded-lg border px-3 py-1.5 text-sm ${
                                  isLocked ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-300 focus:border-indigo-500 focus:outline-none'
                                }`}
                              />
                            ) : (
                              <input
                                type="text"
                                disabled={isLocked}
                                value={String(value ?? '')}
                                onChange={(e) => {
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [t.scope]: { ...prev[t.scope], [key]: e.target.value },
                                  }))
                                }}
                                className={`w-full rounded-lg border px-3 py-1.5 text-sm ${
                                  isLocked ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-300 focus:border-indigo-500 focus:outline-none'
                                }`}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <div className="mt-6 flex justify-between">
                <button onClick={() => setWizardStep(1)} className="text-sm text-gray-500 hover:text-gray-700">Back</button>
                <button
                  onClick={runPreview}
                  disabled={previewLoading}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {previewLoading ? 'Parsing...' : 'Preview Extraction'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Preview & Save */}
          {wizardStep === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Preview & Save</h2>
              <p className="text-sm text-gray-500 mb-6">
                Review the extracted parameters for each agent before saving.
              </p>
              {preview.map((sop) => (
                <div key={sop.scope} className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    {SCOPE_LABELS[sop.scope] ?? sop.scope}
                  </h3>
                  <div className="mb-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">Goal Context</p>
                    <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 overflow-auto">
                      {JSON.stringify(sop.goalContext, null, 2)}
                    </pre>
                  </div>
                  {sop.systemPrompt && (
                    <div className="mb-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">System Prompt</p>
                      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900 whitespace-pre-wrap">{sop.systemPrompt}</p>
                    </div>
                  )}
                  {Object.keys(sop.governance).length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">Governance Overrides</p>
                      <pre className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 overflow-auto">
                        {JSON.stringify(sop.governance, null, 2)}
                      </pre>
                    </div>
                  )}
                  {sop.warnings.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-red-500 mb-1">Warnings</p>
                      <ul className="list-disc list-inside text-xs text-red-700">
                        {sop.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-6 flex justify-between">
                <button onClick={() => setWizardStep(2)} className="text-sm text-gray-500 hover:text-gray-700">Back</button>
                <button
                  onClick={saveScenario}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Scenario'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario list view
  // ---------------------------------------------------------------------------

  const active = scenarios.filter((s) => s.status === 'active')
  const archived = scenarios.filter((s) => s.status !== 'active')

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Settings
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SOP Scenarios</h1>
            <p className="text-sm text-gray-500 mt-1">
              Standard Operating Procedures define how agents behave in different business contexts.
            </p>
          </div>
          <button
            onClick={startWizard}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            + New Scenario
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading scenarios...</div>
        ) : scenarios.length === 0 ? (
          <div className="py-20 text-center rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-4xl">📋</span>
            <p className="mt-3 text-gray-600 font-medium">No scenarios yet</p>
            <p className="text-sm text-gray-400 mt-1">Create your first SOP scenario to guide agent behavior.</p>
            <button
              onClick={startWizard}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Create Scenario
            </button>
          </div>
        ) : (
          <>
            {/* Active scenarios */}
            {active.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Active ({active.length})</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {active.map((s) => {
                    const meta = SCENARIO_META[s.scenario]
                    return (
                      <div key={s.id} className={`rounded-xl border-2 p-4 ${meta?.color ?? 'border-gray-200 bg-white'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{meta?.icon ?? '📋'}</span>
                            <h3 className="font-semibold text-gray-900">{s.scenarioName || meta?.label || s.scenario}</h3>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            Active
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          Created {new Date(s.createdAt).toLocaleDateString()}
                          {s.platform && ` · ${s.platform}`}
                        </p>
                        <button
                          onClick={() => setScenarioStatus(s.id, 'archive')}
                          className="text-xs text-gray-500 hover:text-red-600"
                        >
                          Archive
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Archived */}
            {archived.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 mb-3">Archived ({archived.length})</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {archived.map((s) => {
                    const meta = SCENARIO_META[s.scenario]
                    return (
                      <div key={s.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 opacity-70">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">{meta?.icon ?? '📋'}</span>
                          <h3 className="font-medium text-gray-700">{s.scenarioName || meta?.label || s.scenario}</h3>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">
                          Created {new Date(s.createdAt).toLocaleDateString()}
                        </p>
                        <button
                          onClick={() => setScenarioStatus(s.id, 'activate')}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          Re-activate
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
