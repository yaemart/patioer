import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataOsClient, createDataOsClientFromEnv } from './index.js'

const BASE = 'http://dataos-api:3300'
const KEY = 'secret-internal-key'
const TENANT = '00000000-0000-0000-0000-000000000001'

function makeClient(fetchImpl: typeof fetch, timeoutMs = 5000) {
  return new DataOsClient({ baseUrl: BASE, internalKey: KEY, tenantId: TENANT, timeoutMs, fetchImpl })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DataOsClient', () => {
  beforeEach(() => {
    delete process.env.DATAOS_API_URL
    delete process.env.DATAOS_INTERNAL_KEY
    delete process.env.DATAOS_ENABLED
  })

  it('recordLakeEvent returns true on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.recordLakeEvent({
      tenantId: TENANT,
      agentId: 'price-sentinel',
      eventType: 'price_change',
      payload: { before: 10, after: 12 },
    })
    expect(result).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/internal/v1/lake/events`)
    expect((init.headers as Record<string, string>)['X-DataOS-Internal-Key']).toBe(KEY)
    expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBe(TENANT)
  })

  it('getFeatures returns null on timeout', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          ;(init.signal as AbortSignal).addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const client = makeClient(fetchImpl as unknown as typeof fetch, 10)
    await new Promise((r) => setTimeout(r, 20))
    const result = await client.getFeatures('amazon', 'sku-1')
    expect(result).toBeNull()
  })

  it('getFeatures returns null when DATAOS_ENABLED=0', () => {
    const client = createDataOsClientFromEnv(TENANT, {
      DATAOS_API_URL: BASE,
      DATAOS_INTERNAL_KEY: KEY,
      DATAOS_ENABLED: '0',
    })
    expect(client).toBeNull()
  })

  it('recallMemory returns memories array', async () => {
    const memories = [{ id: 'abc', action: { newPrice: 11 } }]
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ memories }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.recallMemory('price-sentinel', { price: 10 })
    expect(result).toEqual(memories)
  })

  it('createDataOsClientFromEnv returns null without DATAOS_API_URL', () => {
    const client = createDataOsClientFromEnv(TENANT, {
      DATAOS_INTERNAL_KEY: KEY,
    })
    expect(client).toBeNull()
  })

  it('recordPriceEvent returns true on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.recordPriceEvent({
      tenantId: TENANT,
      productId: 'P001',
      priceBefore: 10,
      priceAfter: 12,
      changePct: 20,
      approved: true,
    })
    expect(result).toBe(true)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe(`${BASE}/internal/v1/lake/price-events`)
  })

  it('recordMemory returns the new memory id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'mem-1' }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.recordMemory({
      agentId: 'price-sentinel',
      context: { price: 10 },
      action: { newPrice: 12 },
    })
    expect(result).toBe('mem-1')
  })

  it('returns null on non-ok HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 500))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.getFeatures('shopify', 'P001')
    expect(result).toBeNull()
  })

  it('createDataOsClientFromEnv parses DATAOS_TIMEOUT_MS', () => {
    const client = createDataOsClientFromEnv(TENANT, {
      DATAOS_API_URL: BASE,
      DATAOS_INTERNAL_KEY: KEY,
      DATAOS_TIMEOUT_MS: '3000',
    })
    expect(client).not.toBeNull()
  })

  it('queryEvents builds query string and returns events', async () => {
    const events = [{ id: 'e1' }]
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ events }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.queryEvents({ agentId: 'ps', eventType: 'test', entityId: 'x', limit: 10, sinceMs: 1000 })
    expect(result).toEqual(events)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/internal/v1/lake/events?')
    expect(url).toContain('agentId=ps')
  })

  it('queryPriceEvents returns events', async () => {
    const events = [{ id: 'pe1' }]
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ events }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.queryPriceEvents({ productId: 'P001', limit: 5, sinceMs: 500 })
    expect(result).toEqual(events)
  })

  it('listFeatures returns features array', async () => {
    const features = [{ product_id: 'P001' }]
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ features }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.listFeatures('shopify', { limit: 10, offset: 0 })
    expect(result).toEqual(features)
  })

  it('deleteFeature returns true when deleted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, deleted: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.deleteFeature('shopify', 'P001')
    expect(result).toBe(true)
  })

  it('listDecisions returns decisions array', async () => {
    const decisions = [{ id: 'd1' }]
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ decisions }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.listDecisions('ps', 5)
    expect(result).toEqual(decisions)
  })

  it('queryEvents returns empty array on non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 500))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.queryEvents({ agentId: 'ps' })
    expect(result).toEqual([])
  })

  it('listFeatures returns empty array on non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 500))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.listFeatures('shopify')
    expect(result).toEqual([])
  })

  it('deleteFeature returns false on non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 404))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.deleteFeature('shopify', 'P001')
    expect(result).toBe(false)
  })

  it('listDecisions returns empty array on network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.listDecisions('ps', 5)
    expect(result).toEqual([])
  })

  it('deleteDecision returns true when deleted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, deleted: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.deleteDecision('550e8400-e29b-41d4-a716-446655440002')
    expect(result).toBe(true)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/internal/v1/memory/decisions/')
  })

  it('deleteDecision returns false on non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.deleteDecision('550e8400-e29b-41d4-a716-446655440002')
    expect(result).toBe(false)
  })

  it('writeOutcome sends decisionId and outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.writeOutcome('550e8400-e29b-41d4-a716-446655440002', { success: true })
    expect(result).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/internal/v1/memory/outcome')
    const body = JSON.parse(init.body as string)
    expect(body.decisionId).toBe('550e8400-e29b-41d4-a716-446655440002')
    expect(body.outcome).toEqual({ success: true })
    expect(body.tenantId).toBe(TENANT)
  })

  it('upsertFeature sends feature data with tenantId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.upsertFeature({ platform: 'shopify', productId: 'P01', priceCurrent: 29.99 })
    expect(result).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/internal/v1/features/upsert')
    const body = JSON.parse(init.body as string)
    expect(body.tenantId).toBe(TENANT)
    expect(body.productId).toBe('P01')
    expect(body.priceCurrent).toBe(29.99)
  })

  it('getCapabilities returns capabilities object', async () => {
    const caps = { version: '1.0.0', entities: {} }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(caps))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    const result = await client.getCapabilities()
    expect(result).toEqual(caps)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/internal/v1/capabilities')
  })

  it('recallMemory passes optional limit and minSimilarity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ memories: [] }))
    const client = makeClient(fetchImpl as unknown as typeof fetch)
    await client.recallMemory('agent-x', { key: 'val' }, { limit: 3, minSimilarity: 0.9 })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.limit).toBe(3)
    expect(body.minSimilarity).toBe(0.9)
  })
})
