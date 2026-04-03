'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface OnboardingApiState {
  currentStep: number
  stepData: Record<string, unknown>
  oauthStatus: Record<string, string>
  healthCheckPassed: boolean
  startedAt: string | null
  completedAt: string | null
}

const STEPS = [
  { number: 1, name: 'Account Created', description: 'Your account is ready' },
  { number: 2, name: 'Select Plan', description: 'Choose a plan that fits your business' },
  { number: 3, name: 'Company Info', description: 'Tell us about your company' },
  { number: 4, name: 'Platform OAuth', description: 'Connect your ecommerce platforms', skippable: true },
  { number: 5, name: 'Agent Config', description: 'Choose and configure your AI agents' },
  { number: 6, name: 'Governance', description: 'Set approval rules and oversight', skippable: true },
  { number: 7, name: 'Health Check', description: 'Verify everything is working' },
] as const

const PLANS = [
  { id: 'starter', name: 'Starter', price: '$299/mo', agents: 3, platforms: 1 },
  { id: 'growth', name: 'Growth', price: '$799/mo', agents: 7, platforms: 3 },
  { id: 'scale', name: 'Scale', price: '$1,999/mo', agents: 9, platforms: 5 },
] as const

const PLATFORMS = ['shopify', 'amazon', 'tiktok', 'shopee', 'walmart', 'wayfair'] as const
const AGENTS = ['product-scout', 'price-sentinel', 'support-relay', 'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel'] as const

export default function OnboardingPage() {
  const [state, setState] = useState<OnboardingApiState | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)

  const [selectedPlan, setSelectedPlan] = useState('starter')
  const [companyName, setCompanyName] = useState('')
  const [companyIndustry, setCompanyIndustry] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [enabledAgents, setEnabledAgents] = useState<string[]>(['product-scout'])
  const [approvalThreshold, setApprovalThreshold] = useState(15)

  const tenantHeaders: Record<string, string> = tenantId ? { 'x-tenant-id': tenantId } : {}

  const fetchState = useCallback(async (tid: string) => {
    try {
      const data = await apiFetch<OnboardingApiState>('/api/v1/onboarding/state', {
        headers: { 'x-tenant-id': tid },
      })
      setState(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load onboarding state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    apiFetch<{ tenantId: string }>('/api/v1/auth/me')
      .then((me) => {
        setTenantId(me.tenantId)
        fetchState(me.tenantId)
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [fetchState])

  async function handleAdvance(step: number, input: Record<string, unknown>) {
    setSubmitting(true)
    setError(null)
    try {
      const result = await apiFetch<{ success: boolean; error?: string }>('/api/v1/onboarding/advance', {
        method: 'POST',
        headers: tenantHeaders,
        body: JSON.stringify({ step, input }),
      })
      if (!result.success) {
        setError(result.error ?? 'Step failed')
      } else if (tenantId) {
        await fetchState(tenantId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSkip(step: number) {
    setSubmitting(true)
    setError(null)
    try {
      const result = await apiFetch<{ success: boolean; error?: string }>('/api/v1/onboarding/skip', {
        method: 'POST',
        headers: tenantHeaders,
        body: JSON.stringify({ step }),
      })
      if (!result.success) {
        setError(result.error ?? 'Skip failed')
      } else if (tenantId) {
        await fetchState(tenantId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }

  function toggleAgent(a: string) {
    setEnabledAgents((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a])
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </main>
    )
  }

  if (state?.completedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl text-green-600">&#10003;</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Onboarding Complete!</h1>
          <p className="text-gray-600 mb-6">Your ElectroOS workspace is ready.</p>
          <a
            href="/dashboard"
            className="inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </main>
    )
  }

  const currentStep = state?.currentStep ?? 1

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-center mb-2">Welcome to ElectroOS</h1>
        <p className="text-center text-gray-600 mb-8">Complete these steps to get started</p>

        <div className="mb-6 flex items-center gap-1">
          {STEPS.map((s) => (
            <div
              key={s.number}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s.number < currentStep ? 'bg-green-500'
                  : s.number === currentStep ? 'bg-indigo-500'
                    : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="space-y-3 mb-8">
          {STEPS.map((s) => {
            const isDone = s.number < currentStep
            const isCurrent = s.number === currentStep
            return (
              <div
                key={s.number}
                className={`rounded-lg border p-4 transition-all ${
                  isDone ? 'border-green-200 bg-green-50'
                    : isCurrent ? 'border-indigo-300 bg-white shadow-sm'
                      : 'border-gray-200 bg-white opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      isDone ? 'bg-green-600 text-white'
                        : isCurrent ? 'bg-indigo-600 text-white'
                          : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {isDone ? '\u2713' : s.number}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isDone ? 'text-green-700' : 'text-gray-900'}`}>{s.name}</p>
                    <p className="text-xs text-gray-500">{s.description}</p>
                  </div>
                  {isCurrent && <span className="text-xs font-medium text-indigo-600">Current</span>}
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          {currentStep === 1 && (
            <StepContent
              title="Account Created"
              description="Your account has been set up. Click continue to choose your plan."
            >
              <button
                onClick={() => handleAdvance(1, {})}
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Processing...' : 'Continue'}
              </button>
            </StepContent>
          )}

          {currentStep === 2 && (
            <StepContent title="Select Plan" description="Choose the plan that fits your business needs.">
              <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-3">
                {PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      selectedPlan === plan.id
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-semibold text-gray-900">{plan.name}</p>
                    <p className="text-lg font-bold text-indigo-600 mt-1">{plan.price}</p>
                    <p className="text-xs text-gray-500 mt-2">{plan.agents} agents &middot; {plan.platforms} platform{plan.platforms > 1 ? 's' : ''}</p>
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleAdvance(2, { plan: selectedPlan })}
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Processing...' : 'Continue with ' + PLANS.find((p) => p.id === selectedPlan)?.name}
              </button>
            </StepContent>
          )}

          {currentStep === 3 && (
            <StepContent title="Company Info" description="Tell us about your company.">
              <div className="space-y-4 mb-4">
                <div>
                  <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    id="companyName"
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="Acme Inc."
                  />
                </div>
                <div>
                  <label htmlFor="companyIndustry" className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                  <input
                    id="companyIndustry"
                    type="text"
                    value={companyIndustry}
                    onChange={(e) => setCompanyIndustry(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    placeholder="E-commerce, Retail, etc."
                  />
                </div>
              </div>
              <button
                onClick={() => handleAdvance(3, { company: { name: companyName, industry: companyIndustry || undefined } })}
                disabled={submitting || !companyName.trim()}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Processing...' : 'Continue'}
              </button>
            </StepContent>
          )}

          {currentStep === 4 && (
            <StepContent title="Connect Platforms" description="Connect your ecommerce platforms via OAuth.">
              <div className="grid grid-cols-2 gap-3 mb-4">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`rounded-lg border p-3 text-sm font-medium capitalize transition-colors ${
                      selectedPlatforms.includes(p)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleAdvance(4, {
                    platforms: selectedPlatforms,
                  })}
                  disabled={submitting || selectedPlatforms.length === 0}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Connecting...' : 'Connect & Continue'}
                </button>
                <button
                  onClick={() => handleSkip(4)}
                  disabled={submitting}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Skip
                </button>
              </div>
            </StepContent>
          )}

          {currentStep === 5 && (
            <StepContent title="Agent Configuration" description="Choose which AI agents to enable.">
              <div className="space-y-2 mb-4">
                {AGENTS.map((a) => (
                  <label key={a} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledAgents.includes(a)}
                      onChange={() => toggleAgent(a)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-gray-900 capitalize">{a.replace(/-/g, ' ')}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => handleAdvance(5, { agentConfig: { enabledAgents } })}
                disabled={submitting || enabledAgents.length === 0}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Processing...' : `Continue with ${enabledAgents.length} agent${enabledAgents.length > 1 ? 's' : ''}`}
              </button>
            </StepContent>
          )}

          {currentStep === 6 && (
            <StepContent title="Governance Preferences" description="Set approval thresholds and human oversight.">
              <div className="mb-4">
                <label htmlFor="threshold" className="block text-sm font-medium text-gray-700 mb-1">
                  Price change approval threshold: {approvalThreshold}%
                </label>
                <input
                  id="threshold"
                  type="range"
                  min="0"
                  max="100"
                  value={approvalThreshold}
                  onChange={(e) => setApprovalThreshold(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Price changes above this threshold require human approval</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleAdvance(6, { governancePrefs: { approvalThreshold, humanInLoopAgents: [] } })}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Processing...' : 'Continue'}
                </button>
                <button
                  onClick={() => handleSkip(6)}
                  disabled={submitting}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Skip
                </button>
              </div>
            </StepContent>
          )}

          {currentStep === 7 && (
            <StepContent title="Health Check" description="Verify your workspace is ready.">
              <button
                onClick={() => handleAdvance(7, {})}
                disabled={submitting}
                className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Running health check...' : 'Run Health Check & Complete'}
              </button>
            </StepContent>
          )}
        </div>
      </div>
    </main>
  )
}

function StepContent({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-500 mb-5">{description}</p>
      {children}
    </div>
  )
}
