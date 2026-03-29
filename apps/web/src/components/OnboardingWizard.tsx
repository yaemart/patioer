'use client'

import type { ReactNode } from 'react'

export interface WizardStep {
  number: number
  name: string
  description: string
  skippable?: boolean
}

interface OnboardingWizardProps {
  steps: readonly WizardStep[]
  currentStep: number
  completed: boolean
  children: ReactNode
}

export function OnboardingWizard({ steps, currentStep, completed, children }: OnboardingWizardProps) {
  if (completed) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
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
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      <h1 className="text-2xl font-bold text-center mb-2">Welcome to ElectroOS</h1>
      <p className="text-center text-gray-600 mb-8">Complete these steps to get started</p>

      <div className="mb-6 flex items-center gap-1">
        {steps.map((s) => (
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
        {steps.map((s) => {
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

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {children}
      </div>
    </div>
  )
}
