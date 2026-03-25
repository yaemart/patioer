import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIssueForAgentTicket } from './agent-paperclip-ticket.js'

describe('createIssueForAgentTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty object when bridge is null', async () => {
    await expect(
      createIssueForAgentTicket(null, 't1', 'a1', { title: 'x', body: 'y' }),
    ).resolves.toEqual({})
  })

  it('calls bridge.createIssue and returns paperclipIssue fields', async () => {
    const createIssue = vi.fn().mockResolvedValue({
      issueId: 'iss-1',
      url: 'http://paperclip/issues/1',
      status: 'open',
    })
    const bridge = { createIssue } as unknown as import('@patioer/agent-runtime').PaperclipBridge

    const out = await createIssueForAgentTicket(bridge, 'tenant-1', 'agent-1', {
      title: 'Low stock',
      body: 'SKU details',
    }, 'company-1')

    expect(createIssue).toHaveBeenCalledWith({
      title: 'Low stock',
      description: 'SKU details',
      priority: 'medium',
      companyId: 'company-1',
      agentId: 'agent-1',
      context: { tenantId: 'tenant-1', source: 'electroos-agent' },
    })
    expect(out.paperclipIssue).toEqual({
      issueId: 'iss-1',
      url: 'http://paperclip/issues/1',
      status: 'open',
    })
    expect(out.paperclipError).toBeUndefined()
  })

  it('returns paperclipError when createIssue throws', async () => {
    const bridge = {
      createIssue: vi.fn().mockRejectedValue(new Error('upstream 500')),
    } as unknown as import('@patioer/agent-runtime').PaperclipBridge

    const out = await createIssueForAgentTicket(bridge, 't', 'a', { title: 'x', body: 'y' })
    expect(out.paperclipError).toBe('upstream 500')
    expect(out.paperclipIssue).toBeUndefined()
  })
})
