import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockListTenantIds,
  mockWithTenantDb,
  mockEnsureCompany,
  mockEnsureProject,
  mockEnsureAgent,
  mockRegisterHeartbeat,
} = vi.hoisted(() => ({
  mockListTenantIds: vi.fn(),
  mockWithTenantDb: vi.fn(),
  mockEnsureCompany: vi.fn(),
  mockEnsureProject: vi.fn(),
  mockEnsureAgent: vi.fn(),
  mockRegisterHeartbeat: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  listTenantIds: mockListTenantIds,
  withTenantDb: mockWithTenantDb,
  schema: {
    agents: {
      id: 'id',
      tenantId: 'tenantId',
      type: 'type',
      name: 'name',
      status: 'status',
    },
  },
  eq: vi.fn((col, val) => ({ col, val })),
}))

import { bootstrapActiveAgents, DEFAULT_CRON } from './agent-bootstrap.js'
import type { PaperclipBridge } from '@patioer/agent-runtime'

const TENANT_ID = 'tttttttt-tttt-tttt-tttt-tttttttttttt'

const ACTIVE_AGENT = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: TENANT_ID,
  type: 'price-sentinel' as const,
  name: 'Price Sentinel',
}

function makeBridge(): PaperclipBridge {
  return {
    ensureCompany: mockEnsureCompany,
    ensureProject: mockEnsureProject,
    ensureAgent: mockEnsureAgent,
    registerHeartbeat: mockRegisterHeartbeat,
  } as unknown as PaperclipBridge
}

/**
 * Sets up the two-level DB mock:
 *  1. listTenantIds()            → [TENANT_ID]        (tenants, no RLS)
 *  2. withTenantDb callback      → agents list         (per-tenant, RLS)
 */
function setupMocks(agents: unknown[]) {
  mockListTenantIds.mockResolvedValue([TENANT_ID])

  // agents query inside withTenantDb callback
  mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
    const agentDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(agents),
      }),
    }
    return await cb(agentDb)
  })
}

const APP_BASE_URL = 'https://api.example.com'

beforeEach(() => {
  vi.clearAllMocks()
  mockEnsureCompany.mockResolvedValue({ id: 'company-1' })
  mockEnsureProject.mockResolvedValue({ id: 'project-1' })
  mockEnsureAgent.mockResolvedValue({ id: 'agent-paperclip-1' })
  mockRegisterHeartbeat.mockResolvedValue({ id: 'hb-1' })
})

describe('bootstrapActiveAgents', () => {
  it('registers heartbeat for each active agent', async () => {
    setupMocks([ACTIVE_AGENT])
    const result = await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    expect(result.total).toBe(1)
    expect(result.registered).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(mockRegisterHeartbeat).toHaveBeenCalledOnce()
    expect(mockRegisterHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        cron: DEFAULT_CRON['price-sentinel'],
        callbackUrl: `${APP_BASE_URL}/api/v1/agents/${ACTIVE_AGENT.id}/execute`,
      }),
    )
  })

  it('skips all agents when appBaseUrl is empty', async () => {
    setupMocks([ACTIVE_AGENT])
    const result = await bootstrapActiveAgents(makeBridge(), '')

    expect(result.total).toBe(1)
    expect(result.registered).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockRegisterHeartbeat).not.toHaveBeenCalled()
  })

  it('returns empty result when no active agents exist', async () => {
    setupMocks([])
    const result = await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    expect(result.total).toBe(0)
    expect(result.registered).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(mockEnsureCompany).not.toHaveBeenCalled()
  })

  it('continues processing when one agent registration fails', async () => {
    const agentB = { ...ACTIVE_AGENT, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
    setupMocks([ACTIVE_AGENT, agentB])

    mockEnsureCompany
      .mockResolvedValueOnce({ id: 'company-1' })
      .mockRejectedValueOnce(new Error('Paperclip unavailable'))

    const result = await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    expect(result.total).toBe(2)
    expect(result.registered).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      agentId: agentB.id,
      error: 'Paperclip unavailable',
    })
  })

  it('returns correct counts when multiple agents succeed', async () => {
    const agents = [
      { ...ACTIVE_AGENT, id: 'id-1', type: 'product-scout' as const },
      { ...ACTIVE_AGENT, id: 'id-2', type: 'price-sentinel' as const },
      { ...ACTIVE_AGENT, id: 'id-3', type: 'support-relay' as const },
    ]
    setupMocks(agents)

    const result = await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    expect(result.total).toBe(3)
    expect(result.registered).toBe(3)
    expect(result.errors).toHaveLength(0)
    expect(mockRegisterHeartbeat).toHaveBeenCalledTimes(3)
  })

  it('constructs correct callback URL with appBaseUrl', async () => {
    setupMocks([ACTIVE_AGENT])
    await bootstrapActiveAgents(makeBridge(), 'https://my.api.host')

    expect(mockRegisterHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: `https://my.api.host/api/v1/agents/${ACTIVE_AGENT.id}/execute`,
      }),
    )
  })

  it('uses fallback cron for unknown agent type', async () => {
    const unknownAgent = { ...ACTIVE_AGENT, type: 'unknown-type' as never }
    setupMocks([unknownAgent])

    await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    expect(mockRegisterHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ cron: '0 */6 * * *' }),
    )
  })

  it('queries agents inside withTenantDb (RLS-enforced context)', async () => {
    setupMocks([ACTIVE_AGENT])
    await bootstrapActiveAgents(makeBridge(), APP_BASE_URL)

    // withTenantDb must be called with the correct tenant ID
    expect(mockWithTenantDb).toHaveBeenCalledWith(TENANT_ID, expect.any(Function))
  })
})
