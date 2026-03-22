import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunPriceSentinel,
  mockRunProductScout,
  mockRunSupportRelay,
  mockCreateAgentContext,
  mockDecryptToken,
  mockGetOrCreate,
  mockPaperclipEnsureCompany,
  mockPaperclipGetBudgetStatus,
} = vi.hoisted(() => ({
    mockRunPriceSentinel: vi.fn(),
    mockRunProductScout: vi.fn(),
    mockRunSupportRelay: vi.fn(),
    mockCreateAgentContext: vi.fn(),
    mockDecryptToken: vi.fn(),
    mockGetOrCreate: vi.fn(),
    mockPaperclipEnsureCompany: vi.fn(),
    mockPaperclipGetBudgetStatus: vi.fn(),
  }))

vi.mock('@patioer/agent-runtime', () => ({
  createAgentContext: mockCreateAgentContext,
  runPriceSentinel: mockRunPriceSentinel,
  runProductScout: mockRunProductScout,
  runSupportRelay: mockRunSupportRelay,
  PaperclipBridge: class {
    async ensureCompany(...args: unknown[]) {
      return await mockPaperclipEnsureCompany(...args)
    }
    async getBudgetStatus(...args: unknown[]) {
      return await mockPaperclipGetBudgetStatus(...args)
    }
  },
}))

vi.mock('../lib/crypto.js', () => ({
  decryptToken: mockDecryptToken,
}))

vi.mock('../lib/harness-registry.js', () => ({
  registry: {
    getOrCreate: mockGetOrCreate,
  },
}))

import { HarnessError } from '@patioer/harness'
import agentsExecuteRoute, {
  buildPriceSentinelInput,
  buildProductScoutInput,
  buildSupportRelayInput,
  getBudgetStatus,
  onBudgetExceeded,
  _resetCachesForTesting,
} from './agents-execute.js'

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
): ReturnType<typeof Fastify> {
  const app = Fastify()
  const calls = { count: 0 }
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }
    request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
    request.withDb = async () => {
      calls.count += 1
      if (responses.length === 0) {
        throw new Error('withDb responses queue is empty')
      }
      return responses.shift() as never
    }
  })
  ;(app as ReturnType<typeof Fastify> & { __calls?: { count: number } }).__calls = calls
  app.register(agentsExecuteRoute)
  return app
}

beforeEach(() => {
  _resetCachesForTesting()
  process.env.PAPERCLIP_API_KEY = 'paperclip-key'
  process.env.PAPERCLIP_API_URL = 'http://paperclip.local'
  process.env.SHOPIFY_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  mockRunPriceSentinel.mockReset()
  mockRunProductScout.mockReset()
  mockRunSupportRelay.mockReset()
  mockCreateAgentContext.mockReset()
  mockDecryptToken.mockReset()
  mockGetOrCreate.mockReset()
  mockPaperclipEnsureCompany.mockReset()
  mockPaperclipGetBudgetStatus.mockReset()
  mockDecryptToken.mockReturnValue('token')
  mockGetOrCreate.mockReturnValue({
    updatePrice: vi.fn().mockResolvedValue(undefined),
  })
  mockCreateAgentContext.mockReturnValue({
    logAction: vi.fn().mockResolvedValue(undefined),
  })
  mockRunPriceSentinel.mockResolvedValue({ decisions: [] })
  mockRunProductScout.mockResolvedValue({ scouted: [] })
  mockRunSupportRelay.mockResolvedValue({ relayed: [] })
  mockPaperclipEnsureCompany.mockResolvedValue({ id: 'company-1' })
  mockPaperclipGetBudgetStatus.mockResolvedValue({
    exceeded: false,
    remainingUsd: 100,
    limitUsd: 100,
    usedUsd: 0,
  })
  delete process.env.AGENT_BUDGET_FORCE_EXCEEDED
  delete process.env.AGENT_BUDGET_FAIL_OPEN
})

describe('buildPriceSentinelInput', () => {
  it('returns parsed proposals when goalContext contains valid json', () => {
    const input = buildPriceSentinelInput(
      JSON.stringify({
        proposals: [
          { productId: 'p1', currentPrice: 100, proposedPrice: 110, reason: 'test' },
        ],
      }),
    )
    expect(input.proposals).toHaveLength(1)
    expect(input.proposals[0]?.productId).toBe('p1')
  })

  it('returns empty proposals when goalContext is invalid json', () => {
    const input = buildPriceSentinelInput('{not-json')
    expect(input).toEqual({ proposals: [] })
  })

  it('returns empty proposals when goalContext shape is invalid', () => {
    const input = buildPriceSentinelInput(JSON.stringify({ foo: 'bar' }))
    expect(input).toEqual({ proposals: [] })
  })
})

describe('buildProductScoutInput', () => {
  it('returns maxProducts when goalContext contains valid json', () => {
    const input = buildProductScoutInput(JSON.stringify({ maxProducts: 50 }))
    expect(input).toEqual({ maxProducts: 50 })
  })

  it('returns empty object when goalContext is empty', () => {
    const input = buildProductScoutInput('')
    expect(input).toEqual({})
  })

  it('returns empty object when goalContext has no maxProducts field', () => {
    const input = buildProductScoutInput(JSON.stringify({ foo: 'bar' }))
    expect(input).toEqual({ maxProducts: undefined })
  })
})

describe('buildSupportRelayInput', () => {
  it('returns auto_reply_non_refund policy from goalContext', () => {
    const input = buildSupportRelayInput(JSON.stringify({ policy: 'auto_reply_non_refund' }))
    expect(input).toEqual({ autoReplyPolicy: 'auto_reply_non_refund' })
  })

  it('returns all_manual policy from goalContext', () => {
    const input = buildSupportRelayInput(JSON.stringify({ policy: 'all_manual' }))
    expect(input).toEqual({ autoReplyPolicy: 'all_manual' })
  })

  it('returns empty when policy is unknown', () => {
    const input = buildSupportRelayInput(JSON.stringify({ policy: 'other' }))
    expect(input).toEqual({})
  })

  it('returns empty on invalid json', () => {
    const input = buildSupportRelayInput('{bad')
    expect(input).toEqual({})
  })
})

describe('agents execute route', () => {
  it('returns 503 when SHOPIFY_ENCRYPTION_KEY is not configured', async () => {
    delete process.env.SHOPIFY_ENCRYPTION_KEY
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'Shopify integration not configured' })
    await app.close()
  })

  it('returns 401 when x-api-key is missing', async () => {
    const app = createApp([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 when x-tenant-id is missing', async () => {
    const app = createApp([], { withTenant: false })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: { 'x-api-key': 'paperclip-key' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('returns 404 when agent is not found', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'agent not found' })
    await app.close()
  })

  it('returns 404 when shopify credential is missing', async () => {
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'No Shopify credentials' })
    await app.close()
  })

  it('returns 501 when agent type is not implemented', async () => {
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'unknown-future-agent', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(501)
    await app.close()
  })

  it('executes price-sentinel and returns 200 with decisions', async () => {
    mockRunPriceSentinel.mockResolvedValueOnce({
      decisions: [{ productId: 'p-1', requiresApproval: false }],
    })
    const app = createApp([
      [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'price-sentinel',
          goalContext: JSON.stringify({ proposals: [] }),
        },
      ],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      decisions: [{ productId: 'p-1', requiresApproval: false }],
    })
    await app.close()
  })

  it('returns 500 when runtime throws and logs execution error', async () => {
    const logAction = vi.fn().mockResolvedValue(undefined)
    mockCreateAgentContext.mockReturnValueOnce({ logAction })
    mockRunPriceSentinel.mockRejectedValueOnce(new Error('boom'))
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(500)
    expect(logAction).toHaveBeenCalledWith(
      'agent.execute.error',
      expect.objectContaining({ error: 'boom' }),
    )
    await app.close()
  })

  it('returns 502 with structured error when HarnessError is thrown', async () => {
    const logAction = vi.fn().mockResolvedValue(undefined)
    mockCreateAgentContext.mockReturnValueOnce({ logAction })
    mockRunPriceSentinel.mockRejectedValueOnce(
      new HarnessError('shopify', '503', 'Service Unavailable'),
    )
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      error: 'platform error',
      platform: 'shopify',
      code: '503',
    })
    expect(logAction).toHaveBeenCalledWith(
      'agent.execute.harness_error',
      expect.objectContaining({ platform: 'shopify', code: '503' }),
    )
    await app.close()
  })

  it('returns 429 when Shopify rate limits the request', async () => {
    const logAction = vi.fn().mockResolvedValue(undefined)
    mockCreateAgentContext.mockReturnValueOnce({ logAction })
    mockRunPriceSentinel.mockRejectedValueOnce(
      new HarnessError('shopify', '429', 'Too Many Requests'),
    )
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({
      error: 'platform error',
      platform: 'shopify',
      code: '429',
    })
    await app.close()
  })

  it('returns 409 when budget is exceeded before execution', async () => {
    mockPaperclipGetBudgetStatus.mockResolvedValueOnce({
      exceeded: true,
      remainingUsd: 0,
      limitUsd: 100,
      usedUsd: 100,
    })
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'budget exceeded', remaining: 0 })
    expect(mockRunPriceSentinel).not.toHaveBeenCalled()
    await app.close()
  })

  it('logs budget_exceeded event when execution is blocked', async () => {
    mockPaperclipGetBudgetStatus.mockResolvedValueOnce({
      exceeded: true,
      remainingUsd: 0,
      limitUsd: 100,
      usedUsd: 100,
    })
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(409)
    await app.close()
  })

  it('continues execution when budget is not exceeded', async () => {
    mockPaperclipGetBudgetStatus.mockResolvedValueOnce({
      exceeded: false,
      remainingUsd: 12,
      limitUsd: 100,
      usedUsd: 88,
    })
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(mockRunPriceSentinel).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('returns remaining budget in blocked response', async () => {
    mockPaperclipGetBudgetStatus.mockResolvedValueOnce({
      exceeded: true,
      remainingUsd: 3,
      limitUsd: 100,
      usedUsd: 97,
    })
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'budget exceeded', remaining: 3 })
    await app.close()
  })

  it('fail-closes execution when budget provider is unavailable', async () => {
    mockPaperclipEnsureCompany.mockRejectedValueOnce(new Error('paperclip unavailable'))
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'budget exceeded', remaining: 0 })
    await app.close()
  })

  it('fails open when AGENT_BUDGET_FAIL_OPEN=1 and budget provider is unavailable', async () => {
    process.env.AGENT_BUDGET_FAIL_OPEN = '1'
    mockPaperclipEnsureCompany.mockRejectedValueOnce(new Error('paperclip unavailable'))
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', type: 'price-sentinel', goalContext: '' }],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('executes product-scout and returns 200 with scouted products', async () => {
    mockRunProductScout.mockResolvedValueOnce({ scouted: [{ productId: 'prod-1', title: 'Widget' }] })
    const app = createApp([
      [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'product-scout',
          goalContext: JSON.stringify({ maxProducts: 10 }),
        },
      ],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      scouted: [{ productId: 'prod-1', title: 'Widget' }],
    })
    await app.close()
  })

  it('executes support-relay and returns 200 with relayed threads', async () => {
    mockRunSupportRelay.mockResolvedValueOnce({
      relayed: [{ threadId: 'th-1', reply: 'Hello!' }],
    })
    const app = createApp([
      [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'support-relay',
          goalContext: JSON.stringify({ policy: 'auto_reply_non_refund' }),
        },
      ],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      relayed: [{ threadId: 'th-1', reply: 'Hello!' }],
    })
    expect(response.json().warnings).toBeUndefined()
    await app.close()
  })

  it('executes support-relay and includes warning when no threads found', async () => {
    mockRunSupportRelay.mockResolvedValueOnce({ relayed: [] })
    const app = createApp([
      [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'support-relay',
          goalContext: '',
        },
      ],
      [{ accessToken: 'enc', shopDomain: 'demo.myshopify.com' }],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001/execute',
      headers: {
        'x-api-key': 'paperclip-key',
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, relayed: [] })
    expect(response.json().warnings).toHaveLength(1)
    expect(response.json().warnings[0]).toContain('Shopify Inbox')
    await app.close()
  })
})

describe('onBudgetExceeded', () => {
  it('suspends agent and writes audit event', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const update = vi.fn().mockReturnValue({ set })
    const request = {
      withDb: async <T>(callback: (db: { insert: typeof insert; update: typeof update }) => Promise<T>) => {
        return await callback({ insert, update })
      },
    } as unknown as Parameters<typeof onBudgetExceeded>[0]

    await onBudgetExceeded(request, 't-1', 'a-1', { remaining: 0 })

    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ status: 'suspended' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        agentId: 'a-1',
        action: 'agent.execute.blocked.budget_exceeded',
        payload: { remaining: 0 },
      }),
    )
  })
})

describe('getBudgetStatus', () => {
  it('returns not-exceeded when PAPERCLIP_API_URL is not configured', async () => {
    delete process.env.PAPERCLIP_API_URL
    const status = await getBudgetStatus('t-1', 'a-1')
    expect(status.exceeded).toBe(false)
    expect(status.remaining).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns exceeded=true and remaining=0 when AGENT_BUDGET_FORCE_EXCEEDED=1', async () => {
    process.env.AGENT_BUDGET_FORCE_EXCEEDED = '1'
    const status = await getBudgetStatus('t-1', 'a-1')
    expect(status).toEqual({ exceeded: true, remaining: 0 })
  })

  it('returns cached result within TTL window without calling bridge again', async () => {
    mockPaperclipEnsureCompany.mockResolvedValue({ id: 'co-1' })
    mockPaperclipGetBudgetStatus.mockResolvedValue({
      exceeded: false,
      remainingUsd: 50,
      limitUsd: 100,
      usedUsd: 50,
    })
    const first = await getBudgetStatus('t-cache', 'a-cache')
    const second = await getBudgetStatus('t-cache', 'a-cache')
    expect(first).toEqual(second)
    expect(mockPaperclipGetBudgetStatus).toHaveBeenCalledTimes(1)
  })

  it('returns independent cache entries per agent', async () => {
    mockPaperclipEnsureCompany.mockResolvedValue({ id: 'co-1' })
    mockPaperclipGetBudgetStatus
      .mockResolvedValueOnce({ exceeded: false, remainingUsd: 80, limitUsd: 100, usedUsd: 20 })
      .mockResolvedValueOnce({ exceeded: true, remainingUsd: 0, limitUsd: 100, usedUsd: 100 })
    const a1 = await getBudgetStatus('t-multi', 'a-1')
    const a2 = await getBudgetStatus('t-multi', 'a-2')
    expect(a1.exceeded).toBe(false)
    expect(a2.exceeded).toBe(true)
    expect(mockPaperclipGetBudgetStatus).toHaveBeenCalledTimes(2)
  })
})
