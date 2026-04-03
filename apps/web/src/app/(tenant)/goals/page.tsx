'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Goal {
  id: string
  name: string
  category: string
  period: string
  targetValue: string
  currentValue: string
  unit: string
  isActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

type Category = 'revenue' | 'margin' | 'acos' | 'inventory' | 'customer' | 'custom'
type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly'

const CATEGORIES: Category[] = ['revenue', 'margin', 'acos', 'inventory', 'customer', 'custom']
const PERIODS: Period[] = ['daily', 'weekly', 'monthly', 'quarterly']

const CATEGORY_COLORS: Record<string, string> = {
  revenue: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  margin: 'bg-blue-50 text-blue-700 border-blue-200',
  acos: 'bg-violet-50 text-violet-700 border-violet-200',
  inventory: 'bg-amber-50 text-amber-700 border-amber-200',
  customer: 'bg-pink-50 text-pink-700 border-pink-200',
  custom: 'bg-gray-50 text-gray-700 border-gray-200',
}

function progressPercent(current: string, target: string): number {
  const c = parseFloat(current)
  const t = parseFloat(target)
  if (t <= 0) return 0
  return Math.min(Math.round((c / t) * 100), 100)
}

function progressColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-red-400'
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterCategory, setFilterCategory] = useState<Category | ''>('')

  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState<Category>('revenue')
  const [formPeriod, setFormPeriod] = useState<Period>('monthly')
  const [formTarget, setFormTarget] = useState('')
  const [formUnit, setFormUnit] = useState('USD')
  const [saving, setSaving] = useState(false)

  const fetchGoals = useCallback(() => {
    setLoading(true)
    const qs = filterCategory ? `?category=${filterCategory}&active=true` : '?active=true'
    apiFetch<{ goals: Goal[] }>(`/api/v1/goals${qs}`)
      .then((data) => setGoals(data.goals))
      .catch(() => setGoals([]))
      .finally(() => setLoading(false))
  }, [filterCategory])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  async function handleCreate() {
    if (!formName || !formTarget) return
    setSaving(true)
    try {
      await apiFetch('/api/v1/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          category: formCategory,
          period: formPeriod,
          targetValue: parseFloat(formTarget),
          unit: formUnit,
        }),
      })
      setShowForm(false)
      setFormName('')
      setFormTarget('')
      fetchGoals()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(goal: Goal) {
    await apiFetch(`/api/v1/goals/${goal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !goal.isActive }),
    })
    fetchGoals()
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/v1/goals/${id}`, { method: 'DELETE' })
    fetchGoals()
  }

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Business Goals</h1>
            <p className="text-sm text-gray-500 mt-1">
              {goals.length} active goals configured
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            {showForm ? 'Cancel' : '+ New Goal'}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">New Goal</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                placeholder="Goal name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as Category)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={formPeriod}
                onChange={(e) => setFormPeriod(e.target.value as Period)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Target value"
                value={formTarget}
                onChange={(e) => setFormTarget(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <input
                placeholder="Unit (USD, %, units)"
                value={formUnit}
                onChange={(e) => setFormUnit(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={handleCreate}
                disabled={saving || !formName || !formTarget}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Create Goal'}
              </button>
            </div>
          </div>
        )}

        {/* Category filter */}
        <div className="flex gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setFilterCategory('')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterCategory === '' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setFilterCategory(c)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filterCategory === c ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="py-10 text-center text-gray-500">Loading goals...</div>
        )}

        {/* Goals grid */}
        {!loading && goals.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">No goals configured</p>
            <p className="text-sm text-gray-400 mt-1">
              Set business targets to track agent performance against
            </p>
          </div>
        )}

        {!loading && goals.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {goals.map((goal) => {
              const pct = progressPercent(goal.currentValue, goal.targetValue)
              return (
                <div
                  key={goal.id}
                  className="rounded-xl border border-gray-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{goal.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${CATEGORY_COLORS[goal.category] ?? CATEGORY_COLORS.custom}`}>
                          {goal.category}
                        </span>
                        <span className="text-[10px] text-gray-400">{goal.period}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggle(goal)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title={goal.isActive ? 'Pause' : 'Resume'}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          {goal.isActive ? (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z" />
                          )}
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(goal.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-2">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-lg font-bold text-gray-900">
                        {parseFloat(goal.currentValue).toLocaleString()} <span className="text-xs font-normal text-gray-400">{goal.unit}</span>
                      </span>
                      <span className="text-xs text-gray-500">
                        / {parseFloat(goal.targetValue).toLocaleString()} {goal.unit}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${progressColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-right text-[10px] text-gray-400 mt-0.5">{pct}%</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
