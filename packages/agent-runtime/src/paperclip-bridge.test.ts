import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaperclipBridge } from './paperclip-bridge.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('PaperclipBridge', () => {
  it('creates company via Paperclip API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'company-1' }), { status: 200 }),
    ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000', 'test-key')
    const result = await bridge.createCompany({ name: 'Tenant A' })

    expect(result).toEqual({ id: 'company-1' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/companies',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('falls back to alternate endpoint when first returns 404', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'agent-1' }), { status: 200 }),
      ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000')
    const result = await bridge.createAgent({
      companyId: 'company-1',
      name: 'Price Sentinel',
    })

    expect(result).toEqual({ id: 'agent-1' })
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/agents',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws when response does not include id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000')

    await expect(
      bridge.createIssue({ title: 'Need approval', body: 'Body text' }),
    ).rejects.toThrow('without id')
  })

  it('fails immediately on 401 without trying fallback endpoints', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000')

    await expect(bridge.createCompany({ name: 'Tenant A' })).rejects.toThrow(
      'Paperclip API error 401',
    )

    // Only the first endpoint was tried — no fallback attempted.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails immediately on 500 without trying fallback endpoints', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000')

    await expect(
      bridge.createAgent({ companyId: 'c-1', name: 'Scout' }),
    ).rejects.toThrow('Paperclip API error 500')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to next endpoint on network error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'issue-1' }), { status: 200 }),
      ) as typeof fetch

    const bridge = new PaperclipBridge('http://localhost:3000')
    const result = await bridge.createIssue({
      title: 'Approval needed',
      body: 'Price change > 15%',
    })

    expect(result).toEqual({ id: 'issue-1' })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})
