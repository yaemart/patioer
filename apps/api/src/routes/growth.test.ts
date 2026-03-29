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

function makeMockDeps() {
  const events: Array<Record<string, unknown>> = []

  return {
    referralService: {
      getOrCreateCode: vi.fn(async () => ({ code: 'ELEC-AB12', created: true })),
      applyReferral: vi.fn(async () => ({
        referrerTenantId: TENANT_REFERRER,
        rewardId: 'reward-1',
      })),
    },
    npsService: {
      recordNpsResponse: vi.fn(async () => ({
        id: 'nps-1',
        tenantId: TENANT_A,
        score: 9,
        feedback: 'Great product!',
        createdAt: new Date('2026-03-29T00:00:00.000Z'),
      })),
    },
    eventRecorder: {
      record: vi.fn(async (event: Record<string, unknown>) => { events.push(event) }),
    },
    events,
  }
}

describe('growth routes', () => {
  let app: ReturnType<typeof buildServer>
  let mocks: ReturnType<typeof makeMockDeps>

  beforeEach(async () => {
    mocks = makeMockDeps()
    setGrowthDeps({
      referralService: mocks.referralService,
      npsService: mocks.npsService,
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
      mocks.referralService.getOrCreateCode.mockResolvedValueOnce({
        code: 'ELEC-AB12',
        created: false,
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/growth/referral-code',
        headers: makeAuthHeaders(TENANT_A),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().code).toBe('ELEC-AB12')
      expect(mocks.eventRecorder.record).not.toHaveBeenCalled()
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
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/apply-referral',
        headers: { ...makeAuthHeaders(TENANT_B), 'content-type': 'application/json' },
        payload: { code: 'ELEC-AB12' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().applied).toBe(true)
      expect(mocks.referralService.applyReferral).toHaveBeenCalledWith(TENANT_B, 'ELEC-AB12')
      expect(mocks.eventRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_B,
          eventType: 'growth.referral_applied',
          payload: expect.objectContaining({ code: 'ELEC-AB12', referrerTenantId: TENANT_REFERRER }),
        }),
      )
    })

    it('rejects invalid code', async () => {
      mocks.referralService.applyReferral.mockRejectedValueOnce(
        new Error('Invalid referral code: INVALID'),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/growth/apply-referral',
        headers: { ...makeAuthHeaders(TENANT_B), 'content-type': 'application/json' },
        payload: { code: 'INVALID' },
      })
      expect(res.statusCode).toBe(404)
    })

    it('rejects self-referral', async () => {
      mocks.referralService.applyReferral.mockRejectedValueOnce(
        new Error('Cannot use your own referral code'),
      )

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
      expect(mocks.npsService.recordNpsResponse).toHaveBeenCalledWith(
        TENANT_A,
        9,
        'Great product!',
      )
      expect(mocks.eventRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_A,
          eventType: 'growth.nps_submitted',
          payload: expect.objectContaining({ score: 9, hasFeedback: true }),
        }),
      )
    })

    it('rejects invalid score', async () => {
      mocks.npsService.recordNpsResponse.mockRejectedValueOnce(
        new Error('NPS score must be an integer between 0 and 10'),
      )

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
