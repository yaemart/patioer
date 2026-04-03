import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { schemaMock, state, fakeDb } = vi.hoisted(() => {
  const schemaMock = {
    tenantGovernanceSettings: {
      __table: 'tenantGovernanceSettings',
      id: 'id',
      tenantId: 'tenantId',
      priceChangeThreshold: 'priceChangeThreshold',
      adsBudgetApproval: 'adsBudgetApproval',
      newListingApproval: 'newListingApproval',
      humanInLoopAgents: 'humanInLoopAgents',
    },
    agents: {
      __table: 'agents',
      id: 'id',
      tenantId: 'tenantId',
      type: 'type',
      goalContext: 'goalContext',
    },
  }

  const state = {
    settingsRow: null as Record<string, unknown> | null,
    agents: [] as Array<Record<string, unknown>>,
  }

  function selectRows(
    table: { __table: string },
    fields?: Record<string, unknown>,
    predicate?: (row: Record<string, unknown>) => boolean,
    count?: number,
  ) {
    const source = table.__table === 'tenantGovernanceSettings'
      ? (state.settingsRow ? [state.settingsRow] : [])
      : state.agents

    const rows = source.filter((row) => (predicate ? predicate(row) : true))
    const limited = typeof count === 'number' ? rows.slice(0, count) : rows
    if (fields) {
      return limited.map((row) => {
        const mapped: Record<string, unknown> = {}
        for (const [key, column] of Object.entries(fields)) {
          mapped[key] = row[column as string]
        }
        return mapped
      })
    }
    return limited
  }

  const fakeDb = {
    select: vi.fn((fields?: Record<string, unknown>) => ({
      from: vi.fn((table: { __table: string }) => ({
        where: vi.fn((predicate?: (row: Record<string, unknown>) => boolean) => {
          const rows = selectRows(table, fields, predicate)
          return {
            limit: vi.fn(async (count: number) => selectRows(table, fields, predicate, count)),
            then<TResult1 = typeof rows, TResult2 = never>(
              onfulfilled?: ((value: typeof rows) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(rows).then(onfulfilled, onrejected)
            },
          }
        }),
      })),
    })),
    insert: vi.fn((table: { __table: string }) => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        if (table.__table === 'tenantGovernanceSettings') {
          state.settingsRow = { id: 'settings-1', ...value }
        }
      }),
    })),
    update: vi.fn((table: { __table: string }) => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async (predicate: (row: Record<string, unknown>) => boolean) => {
          if (table.__table === 'tenantGovernanceSettings') {
            if (state.settingsRow && predicate(state.settingsRow)) {
              state.settingsRow = { ...state.settingsRow, ...value }
            }
            return
          }

          for (const row of state.agents) {
            if (predicate(row)) Object.assign(row, value)
          }
        }),
      })),
    })),
  }

  return { schemaMock, state, fakeDb }
})

vi.mock('@patioer/db', () => ({
  schema: schemaMock,
}))

vi.mock('drizzle-orm', () => ({
  eq: (column: string, value: unknown) => (row: Record<string, unknown>) => row[column] === value,
  and: (...predicates: Array<(row: Record<string, unknown>) => boolean>) =>
    (row: Record<string, unknown>) => predicates.every((predicate) => predicate(row)),
}))

import settingsRoute from './settings.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

function buildApp() {
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.tenantId = TENANT_ID
    request.withDb = (async <T>(callback: (db: never) => Promise<T>) =>
      callback(fakeDb as never)) as NonNullable<typeof request.withDb>
  })
  app.register(settingsRoute)
  return app
}

describe('settings governance routes', () => {
  beforeEach(() => {
    state.settingsRow = null
    state.agents = [
      {
        id: 'agent-1',
        tenantId: TENANT_ID,
        type: 'price-sentinel',
        goalContext: JSON.stringify({ proposals: [], approvalThresholdPercent: 15 }),
      },
      {
        id: 'agent-2',
        tenantId: TENANT_ID,
        type: 'product-scout',
        goalContext: JSON.stringify({ maxProducts: 10 }),
      },
    ]
    vi.clearAllMocks()
  })

  it('returns default governance settings when none exist', async () => {
    const app = buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/governance',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      priceChangeThreshold: 15,
      adsBudgetApproval: 500,
      newListingApproval: true,
      humanInLoopAgents: [],
      operatingMode: 'daily',
      approvalMode: 'approval_required',
    })

    await app.close()
  })

  it('persists governance settings and syncs price sentinel threshold', async () => {
    const app = buildApp()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/governance',
      headers: { 'content-type': 'application/json' },
      payload: {
        priceChangeThreshold: 22,
        adsBudgetApproval: 900,
        newListingApproval: false,
        humanInLoopAgents: ['price-sentinel'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      priceChangeThreshold: 22,
      adsBudgetApproval: 900,
      newListingApproval: false,
      humanInLoopAgents: ['price-sentinel'],
      operatingMode: 'daily',
    })

    expect(state.settingsRow).toMatchObject({
      tenantId: TENANT_ID,
      priceChangeThreshold: 22,
      adsBudgetApproval: 900,
      newListingApproval: false,
      humanInLoopAgents: ['price-sentinel'],
      operatingMode: 'daily',
    })

    const priceSentinelGoal = JSON.parse(String(state.agents[0].goalContext))
    expect(priceSentinelGoal.pricingStrategy).toBe('balanced')
    expect(priceSentinelGoal.minMarginPercent).toBeDefined()

    expect(JSON.parse(String(state.agents[1].goalContext))).toEqual({
      maxProducts: 10,
    })

    const readBack = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/governance',
    })

    expect(readBack.statusCode).toBe(200)
    expect(readBack.json()).toMatchObject({
      priceChangeThreshold: 22,
      adsBudgetApproval: 900,
      newListingApproval: false,
      humanInLoopAgents: ['price-sentinel'],
    })

    await app.close()
  })

  it('rejects invalid governance settings body', async () => {
    const app = buildApp()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/governance',
      headers: { 'content-type': 'application/json' },
      payload: {
        priceChangeThreshold: 100,
        adsBudgetApproval: 50,
        newListingApproval: true,
      },
    })

    expect(res.statusCode).toBe(400)

    await app.close()
  })
})
