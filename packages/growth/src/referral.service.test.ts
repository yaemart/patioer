import { describe, expect, it, vi } from 'vitest'
import {
  createReferralService,
  generateReferralCode,
} from './referral.service.js'
import type { ReferralServiceDeps, ReferralStore, RewardStore } from './referral.service.js'
import type { ReferralCode, ReferralReward } from './growth.types.js'

function createMockReferralStore(): ReferralStore {
  const byCode = new Map<string, ReferralCode>()
  const byTenant = new Map<string, ReferralCode>()

  return {
    findByCode: vi.fn(async (code) => byCode.get(code) ?? null),
    findByTenantId: vi.fn(async (tenantId) => byTenant.get(tenantId) ?? null),
    create: vi.fn(async (r) => {
      byCode.set(r.code, r)
      byTenant.set(r.tenantId, r)
    }),
  }
}

function createMockRewardStore(): RewardStore {
  const rewards = new Map<string, ReferralReward>()
  const byNewTenant = new Map<string, ReferralReward>()

  return {
    create: vi.fn(async (r) => {
      rewards.set(r.id, r)
      byNewTenant.set(r.newTenantId, r)
    }),
    findPendingForNewTenant: vi.fn(async (newTenantId) => {
      const r = byNewTenant.get(newTenantId)
      return r?.status === 'pending' ? r : null
    }),
    updateStatus: vi.fn(async (id, status) => {
      const r = rewards.get(id)
      if (r) r.status = status
    }),
  }
}

function makeDeps(overrides?: Partial<ReferralServiceDeps>): ReferralServiceDeps {
  return {
    referralStore: createMockReferralStore(),
    rewardStore: createMockRewardStore(),
    generateId: () => `id-${Date.now()}`,
    ...overrides,
  }
}

describe('generateReferralCode', () => {
  it('produces ELEC-XXXX format', () => {
    const code = generateReferralCode()
    expect(code).toMatch(/^ELEC-[A-Z0-9]{4}$/)
  })

  it('produces different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateReferralCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('createReferralService', () => {
  describe('getOrCreateCode', () => {
    it('creates a new code for a tenant', async () => {
      const deps = makeDeps()
      const svc = createReferralService(deps)

      const code = await svc.getOrCreateCode('t-1')
      expect(code).toMatch(/^ELEC-/)
      expect(deps.referralStore.create).toHaveBeenCalled()
    })

    it('returns existing code if tenant already has one', async () => {
      const store = createMockReferralStore()
      vi.mocked(store.findByTenantId).mockResolvedValue({
        id: 'r-1', tenantId: 't-1', code: 'ELEC-AB12', createdAt: new Date(),
      })
      const deps = makeDeps({ referralStore: store })
      const svc = createReferralService(deps)

      const code = await svc.getOrCreateCode('t-1')
      expect(code).toBe('ELEC-AB12')
      expect(store.create).not.toHaveBeenCalled()
    })
  })

  describe('applyReferral', () => {
    it('creates a pending reward for valid code', async () => {
      const refStore = createMockReferralStore()
      vi.mocked(refStore.findByCode).mockResolvedValue({
        id: 'r-1', tenantId: 't-referrer', code: 'ELEC-AB12', createdAt: new Date(),
      })
      const deps = makeDeps({ referralStore: refStore })
      const svc = createReferralService(deps)

      const result = await svc.applyReferral('t-new', 'ELEC-AB12')
      expect(result.referrerTenantId).toBe('t-referrer')
      expect(deps.rewardStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          referrerTenantId: 't-referrer',
          newTenantId: 't-new',
          status: 'pending',
        }),
      )
    })

    it('rejects invalid code', async () => {
      const deps = makeDeps()
      const svc = createReferralService(deps)

      await expect(svc.applyReferral('t-new', 'INVALID')).rejects.toThrow(
        'Invalid referral code',
      )
    })

    it('rejects self-referral', async () => {
      const refStore = createMockReferralStore()
      vi.mocked(refStore.findByCode).mockResolvedValue({
        id: 'r-1', tenantId: 't-1', code: 'ELEC-AB12', createdAt: new Date(),
      })
      const deps = makeDeps({ referralStore: refStore })
      const svc = createReferralService(deps)

      await expect(svc.applyReferral('t-1', 'ELEC-AB12')).rejects.toThrow(
        'Cannot use your own referral code',
      )
    })
  })

  describe('fulfillReward', () => {
    it('fulfills pending reward', async () => {
      const rwdStore = createMockRewardStore()
      vi.mocked(rwdStore.findPendingForNewTenant).mockResolvedValue({
        id: 'rwd-1',
        referrerTenantId: 't-referrer',
        newTenantId: 't-new',
        rewardType: '20_pct_discount_1_month',
        status: 'pending',
        createdAt: new Date(),
      })
      const deps = makeDeps({ rewardStore: rwdStore })
      const svc = createReferralService(deps)

      const result = await svc.fulfillReward('t-new')
      expect(result.fulfilled).toBe(true)
      expect(result.rewardId).toBe('rwd-1')
      expect(rwdStore.updateStatus).toHaveBeenCalledWith('rwd-1', 'fulfilled')
    })

    it('returns false when no pending reward', async () => {
      const deps = makeDeps()
      const svc = createReferralService(deps)

      const result = await svc.fulfillReward('t-unknown')
      expect(result.fulfilled).toBe(false)
    })
  })
})
