/**
 * DevOS Engineering 组织树（Sprint 5 Task 5.5）— 写入 SRE bootstrap Ticket 的 description，供 DevOS / Paperclip 展示。
 */
import { defaultSlaForPriority, type DevOsTicket } from './ticket-protocol.js'

export interface DevOsOrgNode {
  id: string
  name: string
  role: string
  children?: DevOsOrgNode[]
}

/** 默认工程组织：根 → SRE 团队 → SRE Agent（与 phase2-plan DevOS 蓝图一致）。 */
export const DEVOS_ENGINEERING_ORG: DevOsOrgNode = {
  id: 'engineering',
  name: 'Engineering',
  role: 'organization',
  children: [
    {
      id: 'sre-team',
      name: 'Site Reliability',
      role: 'team',
      children: [{ id: 'sre-agent', name: 'SRE Agent', role: 'agent' }],
    },
  ],
}

/** 生成一次性 bootstrap Ticket（`feature` + P2，含 org JSON）。 */
export function buildSreBootstrapTicket(org: DevOsOrgNode = DEVOS_ENGINEERING_ORG): DevOsTicket {
  const sla = defaultSlaForPriority('P2')
  return {
    type: 'feature',
    priority: 'P2',
    title: 'DevOS Engineering — SRE Agent bootstrap',
    description: JSON.stringify(
      { schema: 'devos-org-chart/v1', org },
      null,
      2,
    ),
    context: {
      tenantId: undefined,
      agentId: 'sre-agent',
    },
    sla,
  }
}
