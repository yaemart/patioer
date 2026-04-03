'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface AgentInfo {
  id: string
  tenantId: string
  type: string
  name: string
  status: string
  goalContext: string | null
  createdAt: string
  updatedAt: string
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  'price-sentinel': 'Monitors competitor pricing and adjusts your prices to maintain margins',
  'ads-optimizer': 'Manages advertising campaigns across platforms for optimal ROAS',
  'inventory-guard': 'Tracks stock levels and generates restock alerts before stockouts',
  'product-scout': 'Discovers new product listing opportunities across marketplaces',
  'support-relay': 'Monitors product reviews and responds to customer feedback',
  'finance-agent': 'Handles order processing, tracking, and exception management',
  'content-writer': 'Generates and optimizes product titles, descriptions, and images',
  'market-intel': 'Monitors regulatory and platform policy compliance',
  'ceo-agent': 'Aggregates cross-platform analytics into unified dashboards',
  'customer-success': 'Manages customer relationships and satisfaction metrics',
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-400',
  suspended: 'bg-amber-400',
  error: 'bg-red-400',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [approvalCounts, setApprovalCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch<{ agents: AgentInfo[] }>('/api/v1/agents'),
      apiFetch<{ approvals: { agentId: string }[] }>('/api/v1/approvals?status=pending').catch(() => ({ approvals: [] })),
    ])
      .then(([agentsData, approvalsData]) => {
        setAgents(agentsData.agents)
        const counts = new Map<string, number>()
        for (const a of approvalsData.approvals) {
          counts.set(a.agentId, (counts.get(a.agentId) ?? 0) + 1)
        }
        setApprovalCounts(counts)
      })
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <main className="py-8 px-6">
        <div className="text-gray-500">Loading agents...</div>
      </main>
    )
  }

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Agent Team</h1>
          <p className="text-sm text-gray-500 mt-1">
            {agents.filter((a) => a.status === 'active').length} active / {agents.length} total agents
          </p>
        </div>

        {agents.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-500 text-lg">No agents configured</p>
            <p className="text-sm text-gray-400 mt-1">
              Import a template from ClipMart to get started
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const pending = approvalCounts.get(agent.id) ?? 0
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-gray-300'}`} />
                      <h3 className="text-sm font-semibold text-gray-900">{agent.name}</h3>
                    </div>
                    {pending > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                        {pending}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    {AGENT_DESCRIPTIONS[agent.type] ?? agent.type}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      {agent.type}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(agent.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
