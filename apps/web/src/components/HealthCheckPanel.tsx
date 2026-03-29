'use client'

import { useState } from 'react'

interface CheckResult {
  name: string
  passed: boolean
  message: string
}

interface HealthCheckPanelProps {
  onRunCheck: () => Promise<{ passed: boolean; items: CheckResult[] }>
}

export function HealthCheckPanel({ onRunCheck }: HealthCheckPanelProps) {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [allPassed, setAllPassed] = useState<boolean | null>(null)

  async function handleRun() {
    setRunning(true)
    setResults(null)
    try {
      const report = await onRunCheck()
      setResults(report.items)
      setAllPassed(report.passed)
    } catch {
      setResults([{ name: 'Health Check', passed: false, message: 'Failed to run health check' }])
      setAllPassed(false)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      {results && (
        <div className="mb-4 space-y-2">
          {results.map((r) => (
            <div
              key={r.name}
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                r.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                r.passed ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
              }`}>
                {r.passed ? '\u2713' : '\u2717'}
              </span>
              <div className="flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-gray-500">{r.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {allPassed === true && (
        <div className="mb-4 rounded-lg bg-green-100 border border-green-300 p-3 text-sm text-green-800 font-medium">
          All checks passed! Your workspace is ready.
        </div>
      )}

      {allPassed === false && (
        <div className="mb-4 rounded-lg bg-red-100 border border-red-300 p-3 text-sm text-red-800 font-medium">
          Some checks failed. Please resolve the issues and try again.
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
          allPassed === true ? 'bg-green-600 hover:bg-green-500' : 'bg-indigo-600 hover:bg-indigo-500'
        }`}
      >
        {running ? 'Running checks...' : allPassed === true ? 'Re-run Health Check' : 'Run Health Check'}
      </button>
    </div>
  )
}
