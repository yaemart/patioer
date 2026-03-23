import { describe, expect, it, vi } from 'vitest'
import type { DevOsClient } from './devos-client.js'
import { runDevOsSeed } from './devos-seed.js'

describe('runDevOsSeed', () => {
  it('does not call client when dryRun', async () => {
    const createTicket = vi.fn()
    const client = { createTicket } as unknown as DevOsClient
    const r = await runDevOsSeed({ client, dryRun: true })
    expect(r).toEqual({ ticketId: '(dry-run)', dryRun: true })
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('calls createTicket when not dryRun', async () => {
    const createTicket = vi.fn().mockResolvedValue({ ticketId: 'tid-99' })
    const client = { createTicket } as unknown as DevOsClient
    const r = await runDevOsSeed({ client, dryRun: false })
    expect(r).toEqual({ ticketId: 'tid-99', dryRun: false })
    expect(createTicket).toHaveBeenCalledOnce()
    const arg = createTicket.mock.calls[0]![0]
    expect(arg.type).toBe('feature')
    expect(arg.title).toContain('SRE')
  })
})
