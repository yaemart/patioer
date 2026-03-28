import { describe, expect, it } from 'vitest'
import { buildSreBootstrapTicket, DEVOS_ENGINEERING_ORG, DEVOS_AGENT_IDS, flattenAgents } from './devos-org-chart.js'

describe('DEVOS_ENGINEERING_ORG', () => {
  it('contains all 12 agents across 8 teams', () => {
    const agents = flattenAgents()
    expect(agents).toHaveLength(12)
    const ids = agents.map((a) => a.id)
    for (const expected of DEVOS_AGENT_IDS) {
      expect(ids).toContain(expected)
    }
  })

  it('has 8 teams under engineering root', () => {
    expect(DEVOS_ENGINEERING_ORG.children).toHaveLength(8)
    for (const team of DEVOS_ENGINEERING_ORG.children!) {
      expect(team.role).toBe('team')
    }
  })

  it('operations team contains SRE and DevOps agents', () => {
    const ops = DEVOS_ENGINEERING_ORG.children!.find((t) => t.id === 'operations-team')
    expect(ops).toBeDefined()
    const agentIds = ops!.children!.map((a) => a.id)
    expect(agentIds).toContain('sre-agent')
    expect(agentIds).toContain('devops-agent')
  })

  it('development team contains Backend, Frontend, and DB agents', () => {
    const dev = DEVOS_ENGINEERING_ORG.children!.find((t) => t.id === 'development-team')
    expect(dev).toBeDefined()
    const agentIds = dev!.children!.map((a) => a.id)
    expect(agentIds).toEqual(['backend-agent', 'frontend-agent', 'db-agent'])
  })
})

describe('buildSreBootstrapTicket', () => {
  it('returns feature ticket with JSON org in description', () => {
    const t = buildSreBootstrapTicket()
    expect(t.type).toBe('feature')
    expect(t.priority).toBe('P2')
    expect(t.title).toContain('12-Agent bootstrap')
    const parsed = JSON.parse(t.description) as { schema: string; org: unknown }
    expect(parsed.schema).toBe('devos-org-chart/v2')
    expect(parsed.org).toEqual(DEVOS_ENGINEERING_ORG)
  })
})
