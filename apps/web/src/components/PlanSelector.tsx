'use client'

const PLANS = [
  { id: 'starter', name: 'Starter', price: '$299/mo', agents: 3, platforms: 1, dataos: 'None', support: 'Email' },
  { id: 'growth', name: 'Growth', price: '$799/mo', agents: 7, platforms: 3, dataos: 'Partial', support: 'Chat' },
  { id: 'scale', name: 'Scale', price: '$1,999/mo', agents: 9, platforms: 5, dataos: 'Full', support: 'Dedicated' },
] as const

interface PlanSelectorProps {
  selected: string
  onSelect: (planId: string) => void
}

export function PlanSelector({ selected, onSelect }: PlanSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {PLANS.map((plan) => {
        const active = selected === plan.id
        return (
          <button
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            className={`rounded-xl border-2 p-5 text-left transition-all ${
              active
                ? 'border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-200'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
            }`}
          >
            <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{plan.price}</p>
            <ul className="mt-3 space-y-1 text-xs text-gray-600">
              <li>{plan.agents} agents</li>
              <li>{plan.platforms} platform{plan.platforms > 1 ? 's' : ''}</li>
              <li>DataOS: {plan.dataos}</li>
              <li>Support: {plan.support}</li>
            </ul>
          </button>
        )
      })}
    </div>
  )
}
