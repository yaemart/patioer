import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaperclipBridge } from './paperclip-bridge.js'
import { PaperclipBridgeError } from './paperclip-bridge.errors.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('PaperclipBridge', () => {
  it('creates company when API returns id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'company-1' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).resolves.toEqual({
      id: 'company-1',
    })
  })

  it('reuses existing company when ensure endpoint returns existing record', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'company-existing' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).resolves.toEqual({
      id: 'company-existing',
    })
  })

  it('creates project and returns id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'project-1' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.ensureProject({ companyId: 'c-1', name: 'default' })).resolves.toEqual({
      id: 'project-1',
    })
  })

  it('creates agent and returns id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'agent-1' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(
      bridge.ensureAgent({
        companyId: 'c-1',
        projectId: 'p-1',
        name: 'Price Sentinel',
        externalAgentId: 'price-sentinel',
      }),
    ).resolves.toEqual({ id: 'agent-1' })
  })

  it('registers heartbeat and returns id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'hb-1' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(
      bridge.registerHeartbeat({
        companyId: 'c-1',
        agentId: 'a-1',
        cron: '0 * * * *',
        callbackUrl: 'http://api.local/callback',
      }),
    ).resolves.toEqual({ id: 'hb-1' })
  })

  it('gets budget status and computes exceeded flag', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ limit_usd: 10, used_usd: 7, remaining_usd: 3 })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.getBudgetStatus('c-1', 'a-1')).resolves.toEqual({
      limitUsd: 10,
      usedUsd: 7,
      remainingUsd: 3,
      exceeded: false,
    })
  })

  it('throws unauthorized error on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).rejects.toMatchObject({
      code: 'unauthorized',
    })
  })

  it('throws rate_limited error on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429)) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', maxRetries: 0 })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('retries on 5xx then succeeds', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ id: 'company-1' })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', retryBaseMs: 1 })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).resolves.toEqual({
      id: 'company-1',
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws network_error on fetch rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', maxRetries: 0 })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).rejects.toMatchObject({
      code: 'network_error',
    })
  })

  it('throws invalid_response when id is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true })) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('createIssue sends POST to /api/issues with title and description', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 'iss-1', url: 'https://paperclip/issues/1', status: 'open' }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', apiKey: 'k' })
    await bridge.createIssue({ title: 'Bug', description: 'details here' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://paperclip.local/api/issues',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"title":"Bug"'),
      }),
    )
    expect(fetchMock.mock.calls[0][1]?.body).toContain('details here')
  })

  it('createIssue uses company-scoped endpoint when companyId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 'iss-2', status: 'backlog' }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', apiKey: 'k' })
    await expect(
      bridge.createIssue({ title: 'Scoped', companyId: 'company-1' }),
    ).resolves.toEqual({
      issueId: 'iss-2',
      url: 'http://paperclip.local/companies/company-1/issues/iss-2',
      status: 'backlog',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://paperclip.local/api/companies/company-1/issues',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('createIssue on 404 falls back to /api/issues and synthesizes non-scoped url when response omits url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'no route' }, 404))
      .mockResolvedValueOnce(jsonResponse({ id: 'iss-fb', status: 'open' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', apiKey: 'k' })
    await expect(bridge.createIssue({ title: 'T', companyId: 'company-1' })).resolves.toEqual({
      issueId: 'iss-fb',
      url: 'http://paperclip.local/issues/iss-fb',
      status: 'open',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://paperclip.local/api/companies/company-1/issues',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://paperclip.local/api/issues',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('createIssue uses default priority medium when not specified', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'i', url: 'u', status: 's' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await bridge.createIssue({ title: 'T' })
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as { priority: string }
    expect(body.priority).toBe('medium')
  })

  it('createIssue returns issueId and url from response', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: 'issue-99', url: 'https://x/y', status: 'open' }),
      ) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local' })
    await expect(bridge.createIssue({ title: 'x' })).resolves.toEqual({
      issueId: 'issue-99',
      url: 'https://x/y',
      status: 'open',
    })
  })

  it('createIssue throws when Paperclip API returns non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)) as typeof fetch
    const bridge = new PaperclipBridge({ baseUrl: 'http://paperclip.local', maxRetries: 0 })
    await expect(bridge.createIssue({ title: 'x' })).rejects.toMatchObject({
      code: 'unknown',
    })
  })

  it('includes api key header when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'company-1' })) as typeof fetch
    globalThis.fetch = fetchMock
    const bridge = new PaperclipBridge({
      baseUrl: 'http://paperclip.local',
      apiKey: 'secret-key',
    })
    await bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://paperclip.local/api/companies/ensure',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
        }),
      }),
    )
  })

  it('respects timeout and throws network_error on timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    ) as unknown as typeof fetch
    const bridge = new PaperclipBridge({
      baseUrl: 'http://paperclip.local',
      timeoutMs: 10,
      maxRetries: 0,
    })
    const promise = bridge.ensureCompany({ tenantId: 't-1', name: 'Tenant A' })
    await expect(promise).rejects.toBeInstanceOf(PaperclipBridgeError)
    await expect(promise).rejects.toMatchObject({ code: 'network_error' })
  })
})
