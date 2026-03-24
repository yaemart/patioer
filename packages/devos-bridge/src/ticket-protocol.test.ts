import { describe, expect, it } from 'vitest'
import { defaultSlaForPriority, isDevOsTicket } from './ticket-protocol.js'
import type { DevOsTicket } from './ticket-protocol.js'

function validTicket(overrides: Partial<DevOsTicket> = {}): DevOsTicket {
  return {
    type: 'harness_update',
    priority: 'P1',
    title: 'Harness failure',
    description: 'stack trace',
    context: { platform: 'amazon', tenantId: 't1' },
    sla: { acknowledge: '4h', resolve: '24h' },
    ...overrides,
  }
}

describe('defaultSlaForPriority', () => {
  it('returns stricter SLA for P0 than P2', () => {
    const p0 = defaultSlaForPriority('P0')
    const p2 = defaultSlaForPriority('P2')
    expect(p0.acknowledge).toBe('1h')
    expect(p0.resolve).toBe('4h')
    expect(p2.acknowledge).toBe('24h')
    expect(p2.resolve).toBe('72h')
  })

  it('returns mid SLA for P1', () => {
    expect(defaultSlaForPriority('P1')).toEqual({
      acknowledge: '4h',
      resolve: '24h',
    })
  })
})

describe('isDevOsTicket', () => {
  it('accepts a minimal valid ticket', () => {
    expect(isDevOsTicket(validTicket())).toBe(true)
  })

  it('rejects non-object', () => {
    expect(isDevOsTicket(null)).toBe(false)
    expect(isDevOsTicket('x')).toBe(false)
  })

  it('rejects wrong type field', () => {
    expect(isDevOsTicket({ ...validTicket(), type: 'not-a-type' })).toBe(false)
  })

  it('rejects empty title', () => {
    expect(isDevOsTicket(validTicket({ title: '' }))).toBe(false)
  })

  it('rejects invalid context reproSteps', () => {
    expect(
      isDevOsTicket(
        validTicket({
          context: { reproSteps: [1, 2] as unknown as string[] },
        }),
      ),
    ).toBe(false)
  })
})
