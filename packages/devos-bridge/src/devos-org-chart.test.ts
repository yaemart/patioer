import { describe, expect, it } from 'vitest'
import { buildSreBootstrapTicket, DEVOS_ENGINEERING_ORG } from './devos-org-chart.js'

describe('DEVOS_ENGINEERING_ORG', () => {
  it('has SRE team and agent nodes', () => {
    const sre = DEVOS_ENGINEERING_ORG.children?.[0]
    expect(sre?.id).toBe('sre-team')
    expect(sre?.children?.[0]?.id).toBe('sre-agent')
  })
})

describe('buildSreBootstrapTicket', () => {
  it('returns feature ticket with JSON org in description', () => {
    const t = buildSreBootstrapTicket()
    expect(t.type).toBe('feature')
    expect(t.priority).toBe('P2')
    expect(t.title).toContain('SRE Agent bootstrap')
    const parsed = JSON.parse(t.description) as { schema: string; org: unknown }
    expect(parsed.schema).toBe('devos-org-chart/v1')
    expect(parsed.org).toEqual(DEVOS_ENGINEERING_ORG)
  })
})
