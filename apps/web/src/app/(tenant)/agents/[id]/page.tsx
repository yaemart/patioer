'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'

interface AgentDetail {
  id: string
  name: string
  type: string
  status: string
  goalContext: string | null
  systemPrompt: string | null
  createdAt: string
  updatedAt: string
}

interface AgentEvent {
  id: string
  agentId: string
  action: string
  payload: Record<string, unknown> | null
  createdAt: string
}

type Tab = 'activity' | 'config'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function AgentDetailPage() {
  const params = useParams()
  const agentId = params.id as string

  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [tab, setTab] = useState<Tab>('activity')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch<{ agent: AgentDetail }>(`/api/v1/agents/${agentId}`),
      apiFetch<{ events: AgentEvent[] }>(`/api/v1/agent-events?agentId=${agentId}&limit=50`),
    ])
      .then(([agentData, eventsData]) => {
        setAgent(agentData.agent)
        setEvents(eventsData.events)
      })
      .catch(() => setAgent(null))
      .finally(() => setLoading(false))
  }, [agentId])

  if (loading) {
    return (
      <main className="py-8 px-6">
        <div className="text-gray-500">Loading agent...</div>
      </main>
    )
  }

  if (!agent) {
    return (
      <main className="py-8 px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Agent Not Found</h1>
          <Link href="/agents" className="text-indigo-600 hover:text-indigo-500 text-sm">Back to Agent Team</Link>
        </div>
      </main>
    )
  }

  const statusDot = agent.status === 'active' ? 'bg-green-400' : agent.status === 'error' ? 'bg-red-400' : 'bg-amber-400'

  return (
    <main className="py-8 px-6">
      <div className="mx-auto max-w-4xl">
        {/* Back + Header */}
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Agent Team
        </Link>

        <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className={`h-3 w-3 rounded-full ${statusDot}`} />
            <h1 className="text-xl font-bold text-gray-900">{agent.name}</h1>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">{agent.type}</span>
          </div>
          <div className="flex gap-4 text-xs text-gray-400">
            <span>Status: {agent.status}</span>
            <span>Created: {new Date(agent.createdAt).toLocaleDateString()}</span>
            <span>Updated: {new Date(agent.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          {(['activity', 'config'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t === 'activity' ? 'Work Log' : 'Configuration'}
            </button>
          ))}
        </div>

        {/* Activity Tab */}
        {tab === 'activity' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              Recent Activity ({events.length} events)
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No events recorded yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
                <ul className="space-y-3">
                  {events.map((evt) => (
                    <li key={evt.id} className="relative pl-8">
                      <span className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-400" />
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-700">{evt.action}</span>
                          <span className="text-[10px] text-gray-400">{timeAgo(evt.createdAt)}</span>
                        </div>
                        {evt.payload && Object.keys(evt.payload).length > 0 && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">Details</summary>
                            <pre className="mt-1 text-[10px] text-gray-500 overflow-x-auto max-h-24">
                              {JSON.stringify(evt.payload, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Config Tab */}
        {tab === 'config' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Goal Context</h2>
              {agent.goalContext ? (
                <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 overflow-x-auto max-h-60">
                  {(() => { try { return JSON.stringify(JSON.parse(agent.goalContext), null, 2) } catch { return agent.goalContext } })()}
                </pre>
              ) : (
                <p className="text-sm text-gray-400">No goal context configured</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">System Prompt</h2>
              {agent.systemPrompt ? (
                <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 overflow-x-auto max-h-60 whitespace-pre-wrap">
                  {agent.systemPrompt}
                </pre>
              ) : (
                <p className="text-sm text-gray-400">No custom system prompt</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
