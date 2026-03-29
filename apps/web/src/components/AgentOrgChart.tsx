'use client'

interface Agent {
  type: string
  name: string
  status: 'active' | 'inactive' | 'paused'
}

interface AgentOrgChartProps {
  agents: Agent[]
  enabledAgents: string[]
  onToggle: (agentType: string) => void
}

const STATUS_STYLES: Record<Agent['status'], string> = {
  active: 'bg-green-100 text-green-700 border-green-300',
  inactive: 'bg-gray-100 text-gray-500 border-gray-200',
  paused: 'bg-yellow-100 text-yellow-700 border-yellow-300',
}

const AGENT_CATALOG: Agent[] = [
  { type: 'product-scout', name: 'Product Scout', status: 'active' },
  { type: 'price-sentinel', name: 'Price Sentinel', status: 'active' },
  { type: 'support-relay', name: 'Support Relay', status: 'active' },
  { type: 'ads-optimizer', name: 'Ads Optimizer', status: 'active' },
  { type: 'inventory-guard', name: 'Inventory Guard', status: 'active' },
  { type: 'content-writer', name: 'Content Writer', status: 'active' },
  { type: 'market-intel', name: 'Market Intel', status: 'active' },
  { type: 'finance-agent', name: 'Finance Agent', status: 'active' },
  { type: 'ceo-agent', name: 'CEO Agent', status: 'active' },
]

export function AgentOrgChart({ agents, enabledAgents, onToggle }: AgentOrgChartProps) {
  const displayed = agents.length > 0 ? agents : AGENT_CATALOG

  return (
    <div className="space-y-2">
      {displayed.map((agent) => {
        const enabled = enabledAgents.includes(agent.type)
        const style = enabled ? STATUS_STYLES.active : STATUS_STYLES.inactive
        return (
          <label
            key={agent.type}
            className={`flex items-center gap-3 rounded-lg border-2 p-3 cursor-pointer transition-all hover:shadow-sm ${style}`}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => onToggle(agent.type)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <span className="text-sm font-medium">{agent.name}</span>
              <span className="ml-2 text-xs opacity-75">({agent.type})</span>
            </div>
            <span className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${
              enabled ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {enabled ? 'on' : 'off'}
            </span>
          </label>
        )
      })}
    </div>
  )
}
