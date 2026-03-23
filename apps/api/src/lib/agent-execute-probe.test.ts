import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AppDb } from '@patioer/db'
import { probeAgentExecution } from './agent-execute-probe.js'

const { mockResolveFirstCred, mockGetOrCreate } = vi.hoisted(() => ({
  mockResolveFirstCred: vi.fn(),
  mockGetOrCreate: vi.fn(),
}))

vi.mock('./resolve-credential.js', () => ({
  resolveFirstCredentialFromDb: (...a: unknown[]) => mockResolveFirstCred(...a),
}))

vi.mock('./harness-from-credential.js', () => ({
  getOrCreateHarnessFromCredential: (...a: unknown[]) => mockGetOrCreate(...a),
}))


const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: vi.fn(() => log) } as never

function makeAgentRows(types: string[]) {
  return types.map((type, i) => ({
    id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    type,
    name: `${type} name`,
  }))
}

function makeTenantDb(agentRows: { id: string; type: string; name: string }[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(agentRows),
      }),
    }),
  } as unknown as AppDb
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveFirstCred.mockResolvedValue({
    cred: { accessToken: 'tok', shopDomain: 'shop', region: 'global', metadata: null },
    platform: 'shopify',
  })
  mockGetOrCreate.mockReturnValue({ getProducts: vi.fn() })
})

describe('probeAgentExecution', () => {
  it('returns ok when pipeline succeeds', async () => {
    const rows = makeAgentRows(['product-scout', 'price-sentinel'])
    const result = await probeAgentExecution({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(rows)),
      log,
    })
    expect(result.ok).toBe(true)
    expect(result.agentType).toBe('product-scout')
    expect(result.platform).toBe('shopify')
    expect(result.probe).toBe('agent_execute')
    expect(result.error).toBeUndefined()
  })

  it('returns ok:false with no_agent_rows when no agents exist', async () => {
    const result = await probeAgentExecution({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb([])),
      log,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no_agent_rows')
    expect(result.agentId).toBe('')
  })

  it('returns ok:false with no_credentials when credential resolve fails', async () => {
    const rows = makeAgentRows(['product-scout'])
    mockResolveFirstCred.mockResolvedValue(null)
    const result = await probeAgentExecution({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(rows)),
      log,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no_credentials')
    expect(result.agentId).toBe(rows[0]!.id)
    expect(result.agentType).toBe('product-scout')
  })

  it('returns ok:false when harness init fails', async () => {
    const rows = makeAgentRows(['product-scout'])
    mockGetOrCreate.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    const result = await probeAgentExecution({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(rows)),
      log,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('harness_init')
    expect(result.error).toContain('decrypt failed')
    expect(result.platform).toBe('shopify')
  })

  it('selects first agent row as canary', async () => {
    const rows = makeAgentRows(['price-sentinel', 'product-scout'])
    const result = await probeAgentExecution({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(rows)),
      log,
    })
    expect(result.ok).toBe(true)
    expect(result.agentType).toBe('price-sentinel')
  })
})
