import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingMachine, createInMemoryStore } from '@patioer/onboarding'
import onboardingWizardRoute, {
  setOnboardingHealthChecker,
  setOnboardingEventRecorder,
  setOnboardingMachine,
  setOnboardingOAuthVerifier,
} from './onboarding-wizard.js'

const HEADERS = { 'x-tenant-id': 'test-tenant-001' }

function createApp() {
  const store = createInMemoryStore()
  const machine = new OnboardingMachine(store)
  setOnboardingMachine(machine)
  setOnboardingOAuthVerifier({
    async verify({ platforms }) {
      return {
        oauthResults: Object.fromEntries(platforms.map((platform) => [platform, 'success'])),
        missingPlatforms: [],
        invalidPlatforms: [],
        guides: [],
      }
    },
  })
  setOnboardingHealthChecker({
    async run() {
      return {
        passed: true,
        items: [],
        totalDurationMs: 5,
        checkedAt: new Date('2026-03-29T00:00:00.000Z'),
      }
    },
  })
  const app = Fastify()
  app.register(onboardingWizardRoute)
  return { app, machine }
}

describe('onboarding wizard routes', () => {
  let appInstance: ReturnType<typeof createApp>
  let recordedEvents: Array<{ tenantId: string; eventType: string; payload: Record<string, unknown> }>

  beforeEach(() => {
    recordedEvents = []
    appInstance = createApp()
    setOnboardingEventRecorder({
      async record(event) {
        recordedEvents.push(event)
      },
    })
  })

  afterEach(async () => {
    setOnboardingOAuthVerifier(null)
    setOnboardingHealthChecker(null)
    await appInstance.app.close()
  })

  describe('GET /api/v1/onboarding/state', () => {
    it('returns initial state for new tenant', async () => {
      const { app } = appInstance
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding/state',
        headers: HEADERS,
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.currentStep).toBe(1)
      expect(body.healthCheckPassed).toBe(false)
      expect(body.completedAt).toBeNull()
    })

    it('rejects missing tenant header', async () => {
      const { app } = appInstance
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding/state',
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().type).toBe('missing_tenant')
    })
  })

  describe('POST /api/v1/onboarding/advance', () => {
    it('advances step 1 successfully', async () => {
      const { app } = appInstance
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 1, input: {} },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
    })

    it('advances step 2 with plan', async () => {
      const { app } = appInstance
      await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 1, input: {} },
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 2, input: { plan: 'growth' } },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
    })

    it('returns 422 for validation errors', async () => {
      const { app } = appInstance
      await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 1, input: {} },
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 2, input: { plan: 'invalid' } },
      })
      expect(res.statusCode).toBe(422)
      expect(res.json().success).toBe(false)
      expect(res.json().error).toMatch(/Invalid plan/)
    })

    it('returns 422 for out-of-order step', async () => {
      const { app } = appInstance
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 3, input: { company: { name: 'Test' } } },
      })
      expect(res.statusCode).toBe(422)
    })

    it('rejects missing tenant header', async () => {
      const { app } = appInstance
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        payload: { step: 1, input: {} },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects step 4 when OAuth verification is still pending', async () => {
      const { app } = appInstance
      setOnboardingOAuthVerifier({
        async verify({ platforms }) {
          return {
            oauthResults: Object.fromEntries(platforms.map((platform) => [platform, 'pending'])),
            missingPlatforms: platforms,
            invalidPlatforms: [],
            guides: [],
          }
        },
      })

      await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 1, input: {} },
      })
      await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 2, input: { plan: 'starter' } },
      })
      await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 3, input: { company: { name: 'OAuth Corp' } } },
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 4, input: { platforms: ['shopify'] } },
      })

      expect(res.statusCode).toBe(422)
      expect(res.json().error).toMatch(/OAuth still pending/)
    })

    it('rejects step 7 when server health check fails', async () => {
      const { app } = appInstance
      setOnboardingHealthChecker({
        async run() {
          return {
            passed: false,
            totalDurationMs: 12,
            checkedAt: new Date('2026-03-29T00:00:00.000Z'),
            items: [
              {
                category: 'data_pipeline',
                name: 'Data Pipeline',
                passed: false,
                message: 'Data pipeline unhealthy',
                durationMs: 12,
              },
            ],
          }
        },
      })

      await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 1, input: {} } })
      await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 2, input: { plan: 'growth' } } })
      await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 3, input: { company: { name: 'Health Corp' } } } })
      await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 4, input: { platforms: ['shopify'] } } })
      await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 5, input: { agentConfig: { enabledAgents: ['product-scout'] } } } })
      await app.inject({ method: 'POST', url: '/api/v1/onboarding/skip', headers: HEADERS, payload: { step: 6 } })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/advance',
        headers: HEADERS,
        payload: { step: 7, input: {} },
      })

      expect(res.statusCode).toBe(422)
      expect(res.json().error).toMatch(/Health check failed/)
    })
  })

  describe('POST /api/v1/onboarding/skip', () => {
    it('skips step 4 successfully', async () => {
      const { app, machine } = appInstance
      await machine.advance('test-tenant-001', 1, {})
      await machine.advance('test-tenant-001', 2, { plan: 'starter' })
      await machine.advance('test-tenant-001', 3, { company: { name: 'Skip Corp' } })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/skip',
        headers: HEADERS,
        payload: { step: 4 },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
    })

    it('returns 422 for non-skippable steps', async () => {
      const { app, machine } = appInstance
      await machine.advance('test-tenant-001', 1, {})

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/skip',
        headers: HEADERS,
        payload: { step: 2 },
      })
      expect(res.statusCode).toBe(422)
      expect(res.json().error).toMatch(/cannot be skipped/)
    })
  })

  it('full flow through API', async () => {
    const { app } = appInstance

    const step1 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 1, input: {} } })
    expect(step1.statusCode).toBe(200)

    const step2 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 2, input: { plan: 'growth' } } })
    expect(step2.statusCode).toBe(200)

    const step3 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 3, input: { company: { name: 'Full Corp' } } } })
    expect(step3.statusCode).toBe(200)

    const step4 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 4, input: { platforms: ['shopify'] } } })
    expect(step4.statusCode).toBe(200)

    const step5 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 5, input: { agentConfig: { enabledAgents: ['product-scout'] } } } })
    expect(step5.statusCode).toBe(200)

    const step6 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/skip', headers: HEADERS, payload: { step: 6 } })
    expect(step6.statusCode).toBe(200)

    const step7 = await app.inject({ method: 'POST', url: '/api/v1/onboarding/advance', headers: HEADERS, payload: { step: 7, input: {} } })
    expect(step7.statusCode).toBe(200)

    const state = await app.inject({ method: 'GET', url: '/api/v1/onboarding/state', headers: HEADERS })
    expect(state.statusCode).toBe(200)
    const final = state.json()
    expect(final.completedAt).not.toBeNull()
    expect(final.healthCheckPassed).toBe(true)
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        tenantId: 'test-tenant-001',
        eventType: 'tenant.onboarded',
      }),
    )
  })
})
