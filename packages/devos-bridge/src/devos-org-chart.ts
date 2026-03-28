/**
 * DevOS Engineering 组织树（Phase 4 · 12 Agent 完整部署）
 * PDF §01 对齐 — 8 teams / 12 agents
 */
import { defaultSlaForPriority, type DevOsTicket } from './ticket-protocol.js'

export interface DevOsOrgNode {
  id: string
  name: string
  role: 'organization' | 'team' | 'agent'
  children?: DevOsOrgNode[]
}

export const DEVOS_AGENT_IDS = [
  'cto-agent',
  'pm-agent',
  'architect-agent',
  'backend-agent',
  'frontend-agent',
  'db-agent',
  'harness-agent',
  'qa-agent',
  'security-agent',
  'devops-agent',
  'sre-agent',
  'codebase-intel',
] as const

export type DevOsAgentId = (typeof DEVOS_AGENT_IDS)[number]

/**
 * 完整 12-Agent 工程组织树（PDF §01 对齐）
 *
 * Engineering (org)
 * ├── Leadership    → CTO Agent (D-01)
 * ├── Product       → PM Agent (D-02)
 * ├── Architecture  → Architect Agent (D-03)
 * ├── Development   → Backend (D-04), Frontend (D-05), DB (D-06)
 * ├── Platform      → Harness Agent (D-07)
 * ├── Quality       → QA Agent (D-08), Security Agent (D-09)
 * ├── Operations    → DevOps Agent (D-10), SRE Agent (D-11)
 * └── Intelligence  → Codebase Intel (D-12)
 */
export const DEVOS_ENGINEERING_ORG: DevOsOrgNode = {
  id: 'engineering',
  name: 'Engineering',
  role: 'organization',
  children: [
    {
      id: 'leadership-team',
      name: 'Leadership',
      role: 'team',
      children: [{ id: 'cto-agent', name: 'CTO Agent', role: 'agent' }],
    },
    {
      id: 'product-team',
      name: 'Product',
      role: 'team',
      children: [{ id: 'pm-agent', name: 'PM Agent', role: 'agent' }],
    },
    {
      id: 'architecture-team',
      name: 'Architecture',
      role: 'team',
      children: [{ id: 'architect-agent', name: 'Architect Agent', role: 'agent' }],
    },
    {
      id: 'development-team',
      name: 'Development',
      role: 'team',
      children: [
        { id: 'backend-agent', name: 'Backend Agent', role: 'agent' },
        { id: 'frontend-agent', name: 'Frontend Agent', role: 'agent' },
        { id: 'db-agent', name: 'DB Agent', role: 'agent' },
      ],
    },
    {
      id: 'platform-team',
      name: 'Platform',
      role: 'team',
      children: [{ id: 'harness-agent', name: 'Harness Agent', role: 'agent' }],
    },
    {
      id: 'quality-team',
      name: 'Quality',
      role: 'team',
      children: [
        { id: 'qa-agent', name: 'QA Agent', role: 'agent' },
        { id: 'security-agent', name: 'Security Agent', role: 'agent' },
      ],
    },
    {
      id: 'operations-team',
      name: 'Operations',
      role: 'team',
      children: [
        { id: 'devops-agent', name: 'DevOps Agent', role: 'agent' },
        { id: 'sre-agent', name: 'SRE Agent', role: 'agent' },
      ],
    },
    {
      id: 'intelligence-team',
      name: 'Intelligence',
      role: 'team',
      children: [{ id: 'codebase-intel', name: 'Codebase Intel', role: 'agent' }],
    },
  ],
}

/** Flatten the org tree to extract all agent nodes. */
export function flattenAgents(node: DevOsOrgNode = DEVOS_ENGINEERING_ORG): DevOsOrgNode[] {
  const agents: DevOsOrgNode[] = []
  if (node.role === 'agent') agents.push(node)
  for (const child of node.children ?? []) agents.push(...flattenAgents(child))
  return agents
}

/** 生成一次性 bootstrap Ticket（`feature` + P2，含 org JSON）。 */
export function buildSreBootstrapTicket(org: DevOsOrgNode = DEVOS_ENGINEERING_ORG): DevOsTicket {
  const sla = defaultSlaForPriority('P2')
  return {
    type: 'feature',
    priority: 'P2',
    title: 'DevOS Engineering — Full 12-Agent bootstrap',
    description: JSON.stringify(
      { schema: 'devos-org-chart/v2', org },
      null,
      2,
    ),
    context: {
      tenantId: undefined,
      agentId: 'cto-agent',
    },
    sla,
  }
}
