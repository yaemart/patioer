import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { mockWithTenantDb, fakeDb, mockPaperclipBridge } = vi.hoisted(() => {
  const fakeDb = {
    select: vi.fn(),
    insert: vi.fn(),
  }
  const mockPaperclipBridge = {
    ensureCompany: vi.fn().mockResolvedValue({ id: 'company-1' }),
    ensureProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
    ensureAgent: vi.fn().mockResolvedValue({ id: 'pc-agent-1' }),
    registerHeartbeat: vi.fn().mockResolvedValue({ id: 'hb-1' }),
  }
  return { mockWithTenantDb: vi.fn(), fakeDb, mockPaperclipBridge }
})

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  schema: {
    agents: { type: 'type', id: 'id', name: 'name', tenantId: 'tenant_id' },
  },
  withTenantDb: mockWithTenantDb,
}))

vi.mock('@patioer/agent-runtime', () => ({
  PaperclipBridge: class {
    ensureCompany = mockPaperclipBridge.ensureCompany
    ensureProject = mockPaperclipBridge.ensureProject
    ensureAgent = mockPaperclipBridge.ensureAgent
    registerHeartbeat = mockPaperclipBridge.registerHeartbeat
  },
}))

import { defaultAgentSpecs, seedDefaultAgents } from './seed-default-agents.js'

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {
    PAPERCLIP_API_URL: process.env.PAPERCLIP_API_URL,
    PAPERCLIP_API_KEY: process.env.PAPERCLIP_API_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
  }

  fakeDb.select.mockReset()
  fakeDb.insert.mockReset()
  mockWithTenantDb.mockReset()
  mockPaperclipBridge.ensureCompany.mockClear()
  mockPaperclipBridge.ensureProject.mockClear()
  mockPaperclipBridge.ensureAgent.mockClear()
  mockPaperclipBridge.registerHeartbeat.mockClear()

  fakeDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  })
  fakeDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  let callCount = 0
  mockWithTenantDb.mockImplementation(
    async (_tenantId: string, callback: (db: unknown) => Promise<unknown>) => {
      callCount++
      if (callCount === 1) {
        fakeDb.select.mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([]),
        })
      }
      if (callCount === 2) {
        fakeDb.select.mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([
            { id: 'a1', type: 'product-scout', name: 'Product Scout' },
            { id: 'a2', type: 'price-sentinel', name: 'Price Sentinel' },
            { id: 'a3', type: 'support-relay', name: 'Support Relay' },
            { id: 'a4', type: 'ads-optimizer', name: 'Ads Optimizer' },
            { id: 'a5', type: 'inventory-guard', name: 'Inventory Guard' },
          ]),
        })
      }
      return await callback(fakeDb)
    },
  )
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('seedDefaultAgents', () => {
  it('creates five default agents for empty tenant', async () => {
    delete process.env.PAPERCLIP_API_URL
    delete process.env.PAPERCLIP_API_KEY
    const result = await seedDefaultAgents({ tenantId: 'tenant-1' })
    expect(result.created).toEqual([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
    expect(result.skipped).toEqual([])
    expect(result.registered).toEqual([])
  })

  it('skips existing agent types and only creates missing ones', async () => {
    delete process.env.PAPERCLIP_API_URL
    mockWithTenantDb.mockReset()
    mockWithTenantDb.mockImplementation(
      async (_tenantId: string, callback: (db: unknown) => Promise<unknown>) => {
        fakeDb.select.mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([
            { type: 'product-scout' },
            { type: 'support-relay' },
            { type: 'ads-optimizer' },
          ]),
        })
        return await callback(fakeDb)
      },
    )
    const result = await seedDefaultAgents({ tenantId: 'tenant-1' })
    expect(result.created).toEqual(['price-sentinel', 'inventory-guard'])
    expect(result.skipped).toEqual(['product-scout', 'support-relay', 'ads-optimizer'])
  })

  it('throws when tenantId is missing', async () => {
    await expect(seedDefaultAgents({ tenantId: '' })).rejects.toThrow('tenantId is required')
  })

  it('dryRun reports would-create types without insert or Paperclip', async () => {
    delete process.env.PAPERCLIP_API_URL
    delete process.env.PAPERCLIP_API_KEY
    mockWithTenantDb.mockReset()
    mockWithTenantDb.mockImplementation(
      async (_tenantId: string, callback: (db: unknown) => Promise<unknown>) => {
        fakeDb.select.mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([]),
        })
        return await callback(fakeDb)
      },
    )
    const insertSpy = vi.spyOn(fakeDb, 'insert')
    const result = await seedDefaultAgents({ tenantId: 'tenant-1', dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.registered).toEqual([])
    expect(result.created).toEqual([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
    expect(result.skipped).toEqual([])
    expect(insertSpy).not.toHaveBeenCalled()
    expect(mockPaperclipBridge.ensureCompany).not.toHaveBeenCalled()
  })

  it('is idempotent: all five types skipped when rows already exist', async () => {
    delete process.env.PAPERCLIP_API_URL
    mockWithTenantDb.mockReset()
    mockWithTenantDb.mockImplementation(
      async (_tenantId: string, callback: (db: unknown) => Promise<unknown>) => {
        fakeDb.select.mockReturnValueOnce({
          from: vi.fn().mockResolvedValue([
            { type: 'product-scout' },
            { type: 'price-sentinel' },
            { type: 'support-relay' },
            { type: 'ads-optimizer' },
            { type: 'inventory-guard' },
          ]),
        })
        return await callback(fakeDb)
      },
    )
    const result = await seedDefaultAgents({ tenantId: 'tenant-1' })
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
  })

  it('registers agents with Paperclip when configured', async () => {
    process.env.PAPERCLIP_API_URL = 'http://paperclip.local'
    process.env.PAPERCLIP_API_KEY = 'test-key'
    process.env.APP_BASE_URL = 'http://app.local'

    const result = await seedDefaultAgents({ tenantId: 'tenant-1' })
    expect(result.registered).toEqual([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
    expect(mockPaperclipBridge.ensureCompany).toHaveBeenCalledOnce()
    expect(mockPaperclipBridge.ensureProject).toHaveBeenCalledOnce()
    expect(mockPaperclipBridge.ensureAgent).toHaveBeenCalledTimes(5)
    expect(mockPaperclipBridge.registerHeartbeat).toHaveBeenCalledTimes(5)
  })

  it('skips Paperclip registration when env is not configured', async () => {
    delete process.env.PAPERCLIP_API_URL
    delete process.env.PAPERCLIP_API_KEY
    const result = await seedDefaultAgents({ tenantId: 'tenant-1' })
    expect(result.registered).toEqual([])
    expect(mockPaperclipBridge.ensureCompany).not.toHaveBeenCalled()
  })

  it('uses appBaseUrl from input over env', async () => {
    process.env.PAPERCLIP_API_URL = 'http://paperclip.local'
    process.env.PAPERCLIP_API_KEY = 'test-key'
    process.env.APP_BASE_URL = 'http://env.local'

    await seedDefaultAgents({ tenantId: 'tenant-1', appBaseUrl: 'http://custom.local' })
    const call = mockPaperclipBridge.registerHeartbeat.mock.calls[0]?.[0]
    expect(call?.callbackUrl).toContain('http://custom.local')
  })
})

describe('defaultAgentSpecs', () => {
  it('returns five defaults in stable order', () => {
    const specs = defaultAgentSpecs()
    expect(specs.map((s) => s.type)).toEqual([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
  })
})
