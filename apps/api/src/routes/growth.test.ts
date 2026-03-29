import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildServer } from '../app.js'
import { setGrowthDeps } from './growth.js'

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const TENANT_B = '00000000-0000-0000-0000-000000000002'
const TENANT_REFERRER = '00000000-0000-0000-0000-000000000099'

function makeAuthHeaders(tenantId: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    userId: 'user-test',
    tenantId,
    email: 'growth@example.com',
    role: 'owner',
    plan: 'starter',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = createHmac('sha256', 'dev-only-secret-not-for-production')
    .update(`${header}.${body}`)
    .digest('base64url')
  return {
    authorization: `Bearer ${header}.${body}.${signature}`,
    'x-tenant-id': tenantId,
  }
}

function makeMachineAuthHeaders(tenantId: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    tenantId,
    role: 'service',
    plan: 'starter',
    subjectType: 'machine',
    serviceAccountId: 'svc-growth-1',
    serviceAccountName: 'growth-bot',
    scopes: ['growth:write'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = createHmac('sha256', 'dev-only-secret-not-for-production')
    .update(`${header}.${body}`)
    .digest('base64url')
  return {
    authorization: `Bearer ${header}.${body}.${signature}`,
    'x-tenant-id': tenantId,
  }
}

function makeMockStores() {
  const codes = new Map<string, { id: string; tenantId: string; code: string }>()
  const rewards: Array<Record<string, unknown>> = []
  const npsResponses: Array<Record<string, unknown>> = []
  const events: Array<Record<string, unknown>> = []

  return {
    referralCodeStore: {
      findByCode: vi.fn(async (code: string) => codes.get(code) ?? null),
      findByTenantId: vi.fn(async (tenantId: string) => {
        for (const c of codes.values()) {
          if (c.tenantId === tenantId) return c
        }
        return null
      }),
      create: vi.fn(async (entry: { id: string; tenantId: string; code: string; createdAt: Date }) => {
        codes.set(entry.code, { id: entry.id, tenantId: entry.tenantId, code: entry.code })
      }),
    },
    rewardStore: {
      create: vi.fn(async (entry: Record<string, unknown>) => { rewards.push(entry) }),
    },
    npsStore: {
      hasReceivedNps: vi.fn().mockResolvedValue(false),
      recordResponse: vi.fn(async (resp: Record<string, unknown>) => { npsResponses.push(resp) }),
    },
    eventRecorder: {
      record: vi.fn(async (event: Record<string, unknown>) => { events.push(event) }),
    },
    rewards,
    npsResponses,
    events,
  }
}

describe('growth routes', () => {
  let app: ReturnType<typeof buildServer>
  let mocks: ReturnType<typeof makeMockStores>

  beforeEach(async () => {
    mocks = makeMockStores()
    setGrowthDeps({
      referralCodeStore: mocks.referralCodeStore,
      rewardStore: mocks.rewardStore,
      npsStore: mocks.npsStore,
      eventRecorder: mocks.eventRecorder,
    })
    app = buildServer()
    await app.ready()
  })

  describe('GET /api/v1/growth/referral-code', () => {
    it('generates a new referral code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/growth/referral-code',
        headers: makeAuthHeaders(TENANT_A),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.code).toMatch(/^ELEC-[A-Z0-9]{4}$/)
      expect(mocks.eventRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_A,
          eventType: 'growth.referral_code_generated',
        }),
      )
    })

    it('returns existing code for tenant', async () => {
      mocks.referralCodeStore.findByTenantId.mockResolvedValueOnce({
        id: 'existing-code-id',
        tenantId: TENANT_A,
        code: 'ELEC-AB12',
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/growth/referral-code',
        headers: makeAuthHeaders(TENANT_A),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().code).toBe('ELEC-AB12')
    })

    it('accepts machine JWT authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/growth/referral-code',
        headers: makeMachineAuthHeaders(TENANT_A),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().code).toMatch(/^ELEC-[A-Z0-9]{4}$/)
    })

    it('rejects missing JWT authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/growth/referral-code',
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /api/v1/growth/apply-referral', () => {
    it('applies valid referral code', async () => {
      mocks.referralCodeStore.findByCode.mockResolvedValueOnce({
        id: 'r-1', tenantId: TENANT_REFERRER, code: 'ELEC-AB12',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/apply-referral',
        headers: { ...makeAuthHeaders(TENANT_B), 'content-type': 'application/json' },
        payload: { code: 'ELEC-AB12' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().applied).toBe(true)
      expect(mocks.rewardStore.create).toHaveBeenCalled()
      expect(mocks.eventRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_B,
          eventType: 'growth.referral_applied',
          payload: expect.objectContaining({ code: 'ELEC-AB12', referrerTenantId: TENANT_REFERRER }),
        }),
      )
    })

    it('rejects invalid code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/apply-referral',
        headers: { ...makeAuthHeaders(TENANT_B), 'content-type': 'application/json' },
        payload: { code: 'INVALID' },
      })
      expect(res.statusCode).toBe(404)
    })

    it('rejects self-referral', async () => {
      mocks.referralCodeStore.findByCode.mockResolvedValueOnce({
        id: 'r-1', tenantId: TENANT_A, code: 'ELEC-AB12',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/apply-referral',
        headers: { ...makeAuthHeaders(TENANT_A), 'content-type': 'application/json' },
        payload: { code: 'ELEC-AB12' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /api/v1/growth/nps', () => {
    it('records valid NPS response', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/nps',
        headers: { ...makeAuthHeaders(TENANT_A), 'content-type': 'application/json' },
        payload: { score: 9, feedback: 'Great product!' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().recorded).toBe(true)
      expect(mocks.npsStore.recordResponse).toHaveBeenCalled()
      expect(mocks.eventRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_A,
          eventType: 'growth.nps_submitted',
          payload: expect.objectContaining({ score: 9, hasFeedback: true }),
        }),
      )
    })

    it('rejects invalid score', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/nps',
        headers: { ...makeAuthHeaders(TENANT_A), 'content-type': 'application/json' },
        payload: { score: 15 },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
