import { describe, expect, it, vi } from 'vitest'
import { createNpsService, classifyNps } from './nps.service.js'
import type { NpsServiceDeps, NpsTenantInfo, NpsStore } from './nps.service.js'
import type { NpsResponse } from './growth.types.js'

function createMockStore(): NpsStore {
  const data = new Map<string, NpsResponse[]>()
  const sent = new Set<string>()

  return {
    hasReceivedNps: vi.fn(async (tenantId) => sent.has(tenantId)),
    recordResponse: vi.fn(async (response) => {
      const list = data.get(response.tenantId) ?? []
      list.push({ ...response, createdAt: new Date() })
      data.set(response.tenantId, list)
      sent.add(response.tenantId)
    }),
    getResponses: vi.fn(async (tenantId) => data.get(tenantId) ?? []),
  }
}

function createDeps(store?: NpsStore): NpsServiceDeps {
  return {
    store: store ?? createMockStore(),
    email: { send: vi.fn().mockResolvedValue(undefined) },
    generateId: () => 'nps-id-1',
  }
}

describe('classifyNps', () => {
  it('classifies promoters (9-10)', () => {
    expect(classifyNps(9)).toBe('promoter')
    expect(classifyNps(10)).toBe('promoter')
  })

  it('classifies passives (7-8)', () => {
    expect(classifyNps(7)).toBe('passive')
    expect(classifyNps(8)).toBe('passive')
  })

  it('classifies detractors (0-6)', () => {
    expect(classifyNps(0)).toBe('detractor')
    expect(classifyNps(6)).toBe('detractor')
  })
})

describe('createNpsService', () => {
  describe('checkAndSendNps', () => {
    it('sends NPS when tenant registered >= 30 days ago', async () => {
      const deps = createDeps()
      const svc = createNpsService(deps)

      const tenant: NpsTenantInfo = {
        tenantId: 't-1',
        registeredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        email: 'test@example.com',
      }

      const sent = await svc.checkAndSendNps(tenant)
      expect(sent).toBe(true)
      expect(deps.email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' }),
      )
    })

    it('does not send NPS when tenant is too recent', async () => {
      const deps = createDeps()
      const svc = createNpsService(deps)

      const tenant: NpsTenantInfo = {
        tenantId: 't-1',
        registeredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        email: 'test@example.com',
      }

      const sent = await svc.checkAndSendNps(tenant)
      expect(sent).toBe(false)
      expect(deps.email.send).not.toHaveBeenCalled()
    })

    it('does not send NPS if already sent', async () => {
      const store = createMockStore()
      vi.mocked(store.hasReceivedNps).mockResolvedValue(true)
      const deps = createDeps(store)
      const svc = createNpsService(deps)

      const tenant: NpsTenantInfo = {
        tenantId: 't-1',
        registeredAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        email: 'test@example.com',
      }

      const sent = await svc.checkAndSendNps(tenant)
      expect(sent).toBe(false)
    })
  })

  describe('recordNpsResponse', () => {
    it('records a valid NPS response', async () => {
      const deps = createDeps()
      const svc = createNpsService(deps)

      const response = await svc.recordNpsResponse('t-1', 9, 'Great product!')
      expect(response.score).toBe(9)
      expect(response.feedback).toBe('Great product!')
      expect(response.tenantId).toBe('t-1')
    })

    it('rejects invalid score', async () => {
      const deps = createDeps()
      const svc = createNpsService(deps)

      await expect(svc.recordNpsResponse('t-1', 11, null)).rejects.toThrow(
        'NPS score must be an integer between 0 and 10',
      )
      await expect(svc.recordNpsResponse('t-1', -1, null)).rejects.toThrow()
      await expect(svc.recordNpsResponse('t-1', 5.5, null)).rejects.toThrow()
    })
  })

  describe('calculateNpsScore', () => {
    it('calculates correct NPS from responses', async () => {
      const store = createMockStore()
      const deps = createDeps(store)
      const svc = createNpsService(deps)

      await svc.recordNpsResponse('t-1', 10, null)
      await svc.recordNpsResponse('t-1', 9, null)
      await svc.recordNpsResponse('t-1', 7, null)
      await svc.recordNpsResponse('t-1', 3, null)

      const result = await svc.calculateNpsScore(['t-1'])
      expect(result.promoters).toBe(2)
      expect(result.passives).toBe(1)
      expect(result.detractors).toBe(1)
      expect(result.total).toBe(4)
      expect(result.npsScore).toBe(25)
    })

    it('returns 0 for no responses', async () => {
      const deps = createDeps()
      const svc = createNpsService(deps)

      const result = await svc.calculateNpsScore(['t-1'])
      expect(result.npsScore).toBe(0)
      expect(result.total).toBe(0)
    })
  })
})
