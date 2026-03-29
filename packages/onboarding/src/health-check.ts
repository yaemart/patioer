export type CheckCategory = 'api_connectivity' | 'agent_heartbeat' | 'data_pipeline' | 'approval_system'

export interface HealthCheckItem {
  category: CheckCategory
  name: string
  passed: boolean
  message: string
  durationMs: number
}

export interface HealthCheckReport {
  passed: boolean
  items: HealthCheckItem[]
  totalDurationMs: number
  checkedAt: Date
}

export interface HealthCheckDeps {
  checkApiConnectivity(): Promise<{ ok: boolean; latencyMs: number }>
  checkAgentHeartbeat(): Promise<{ ok: boolean; activeAgents: number; totalAgents: number }>
  checkDataPipeline(): Promise<{ ok: boolean; lastEventAge: number | null }>
  checkApprovalSystem(): Promise<{ ok: boolean; pendingCount: number }>
}

function item(
  category: CheckCategory,
  name: string,
  passed: boolean,
  message: string,
  durationMs: number,
): HealthCheckItem {
  return { category, name, passed, message, durationMs }
}

export async function runHealthCheck(deps: HealthCheckDeps): Promise<HealthCheckReport> {
  const items: HealthCheckItem[] = []
  const start = Date.now()

  const apiStart = Date.now()
  try {
    const api = await deps.checkApiConnectivity()
    items.push(item(
      'api_connectivity',
      'API Connectivity',
      api.ok,
      api.ok ? `API reachable (${api.latencyMs}ms)` : 'API unreachable',
      Date.now() - apiStart,
    ))
  } catch {
    items.push(item('api_connectivity', 'API Connectivity', false, 'API check threw an error', Date.now() - apiStart))
  }

  const agentStart = Date.now()
  try {
    const agent = await deps.checkAgentHeartbeat()
    items.push(item(
      'agent_heartbeat',
      'Agent Heartbeat',
      agent.ok,
      agent.ok
        ? `${agent.activeAgents}/${agent.totalAgents} agents alive`
        : `Only ${agent.activeAgents}/${agent.totalAgents} agents responding`,
      Date.now() - agentStart,
    ))
  } catch {
    items.push(item('agent_heartbeat', 'Agent Heartbeat', false, 'Agent heartbeat check failed', Date.now() - agentStart))
  }

  const pipeStart = Date.now()
  try {
    const pipe = await deps.checkDataPipeline()
    items.push(item(
      'data_pipeline',
      'Data Pipeline',
      pipe.ok,
      pipe.ok
        ? `Pipeline active${pipe.lastEventAge !== null ? ` (last event ${pipe.lastEventAge}s ago)` : ''}`
        : 'Data pipeline unhealthy',
      Date.now() - pipeStart,
    ))
  } catch {
    items.push(item('data_pipeline', 'Data Pipeline', false, 'Data pipeline check failed', Date.now() - pipeStart))
  }

  const approvalStart = Date.now()
  try {
    const approval = await deps.checkApprovalSystem()
    items.push(item(
      'approval_system',
      'Approval System',
      approval.ok,
      approval.ok
        ? `Approval system ready (${approval.pendingCount} pending)`
        : 'Approval system unavailable',
      Date.now() - approvalStart,
    ))
  } catch {
    items.push(item('approval_system', 'Approval System', false, 'Approval system check failed', Date.now() - approvalStart))
  }

  return {
    passed: items.every((i) => i.passed),
    items,
    totalDurationMs: Date.now() - start,
    checkedAt: new Date(),
  }
}

export function createNoopDeps(): HealthCheckDeps {
  return {
    async checkApiConnectivity() { return { ok: true, latencyMs: 0 } },
    async checkAgentHeartbeat() { return { ok: true, activeAgents: 0, totalAgents: 0 } },
    async checkDataPipeline() { return { ok: true, lastEventAge: null } },
    async checkApprovalSystem() { return { ok: true, pendingCount: 0 } },
  }
}
