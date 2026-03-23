import { describe, expect, it, vi } from 'vitest'
import {
  buildHarnessUpdateTicket,
  deriveHarnessUpdatePriority,
  reportHarnessErrorToDevOs,
} from './harness-update-ticket.js'
import { isDevOsTicket } from './ticket-protocol.js'
import type { DevOsClient } from './devos-client.js'

describe('deriveHarnessUpdatePriority', () => {
  it('returns P2 for not-found style codes', () => {
    expect(
      deriveHarnessUpdatePriority({
        platform: 'shopify',
        code: '404',
        message: 'nope',
      }),
    ).toBe('P2')
    expect(
      deriveHarnessUpdatePriority({
        platform: 'amazon',
        code: 'product_not_found',
        message: 'nope',
      }),
    ).toBe('P2')
  })

  it('returns P1 for typical failure codes', () => {
    expect(
      deriveHarnessUpdatePriority({
        platform: 'shopify',
        code: '500',
        message: 'upstream',
      }),
    ).toBe('P1')
    expect(
      deriveHarnessUpdatePriority({
        platform: 'tiktok',
        code: 'network_error',
        message: 'econnreset',
      }),
    ).toBe('P1')
  })
})

describe('buildHarnessUpdateTicket', () => {
  it('buildHarnessUpdateTicket uses type harness_update and valid DevOsTicket shape', () => {
    const ticket = buildHarnessUpdateTicket({
      platform: 'shopify',
      code: '500',
      message: 'bad gateway',
      tenantId: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
      agentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    expect(ticket.type).toBe('harness_update')
    expect(isDevOsTicket(ticket)).toBe(true)
    expect(ticket.title).toContain('shopify')
    expect(ticket.context.platform).toBe('shopify')
    expect(ticket.context.tenantId).toBe('tttttttt-tttt-tttt-tttt-tttttttttttt')
    expect(ticket.context.agentId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })
})

describe('reportHarnessErrorToDevOs', () => {
  it('reportHarnessErrorToDevOs does not call client when dryRun', async () => {
    const createTicket = vi.fn()
    const client = { createTicket } as unknown as DevOsClient
    const out = await reportHarnessErrorToDevOs({
      client,
      report: { platform: 'x', code: '500', message: 'm' },
      dryRun: true,
    })
    expect(createTicket).not.toHaveBeenCalled()
    expect(out).toEqual({ ticketId: '', dryRun: true })
  })

  it('reportHarnessErrorToDevOs calls createTicket when not dryRun', async () => {
    const createTicket = vi.fn().mockResolvedValue({ ticketId: 't-1' })
    const client = { createTicket } as unknown as DevOsClient
    const out = await reportHarnessErrorToDevOs({
      client,
      report: { platform: 'shopify', code: '429', message: 'rl' },
    })
    expect(createTicket).toHaveBeenCalledOnce()
    expect(out).toEqual({ ticketId: 't-1', dryRun: false })
  })
})
