import type { ReferralCode, ReferralReward } from './growth.types.js'

export interface ReferralStore {
  findByCode(code: string): Promise<ReferralCode | null>
  findByTenantId(tenantId: string): Promise<ReferralCode | null>
  create(referral: ReferralCode): Promise<void>
}

export interface RewardStore {
  create(reward: ReferralReward): Promise<void>
  findPendingForNewTenant(newTenantId: string): Promise<ReferralReward | null>
  updateStatus(rewardId: string, status: ReferralReward['status']): Promise<void>
}

export interface ReferralServiceDeps {
  referralStore: ReferralStore
  rewardStore: RewardStore
  generateId: () => string
}

export interface ReferralCodeResult {
  code: string
  created: boolean
}

const CODE_PREFIX = 'ELEC'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_SUFFIX_LEN = 4

export function generateReferralCode(randomFn: () => number = Math.random): string {
  let suffix = ''
  for (let i = 0; i < CODE_SUFFIX_LEN; i++) {
    suffix += CODE_CHARS[Math.floor(randomFn() * CODE_CHARS.length)]
  }
  return `${CODE_PREFIX}-${suffix}`
}

export function createReferralService(deps: ReferralServiceDeps) {
  const { referralStore, rewardStore, generateId } = deps

  async function getOrCreateCode(tenantId: string): Promise<ReferralCodeResult> {
    const existing = await referralStore.findByTenantId(tenantId)
    if (existing) {
      return { code: existing.code, created: false }
    }

    let code: string
    let attempts = 0
    do {
      code = generateReferralCode()
      const conflict = await referralStore.findByCode(code)
      if (!conflict) break
      attempts++
    } while (attempts < 10)

    if (attempts >= 10) {
      throw new Error('Failed to generate unique referral code after 10 attempts')
    }

    await referralStore.create({
      id: generateId(),
      tenantId,
      code,
      createdAt: new Date(),
    })

    return { code, created: true }
  }

  async function applyReferral(
    newTenantId: string,
    code: string,
  ): Promise<{ referrerTenantId: string; rewardId: string }> {
    const referral = await referralStore.findByCode(code)
    if (!referral) {
      throw new Error(`Invalid referral code: ${code}`)
    }

    if (referral.tenantId === newTenantId) {
      throw new Error('Cannot use your own referral code')
    }

    const rewardId = generateId()
    await rewardStore.create({
      id: rewardId,
      referrerTenantId: referral.tenantId,
      newTenantId,
      rewardType: '20_pct_discount_1_month',
      status: 'pending',
      createdAt: new Date(),
    })

    return { referrerTenantId: referral.tenantId, rewardId }
  }

  async function fulfillReward(newTenantId: string): Promise<{ fulfilled: boolean; rewardId?: string }> {
    const reward = await rewardStore.findPendingForNewTenant(newTenantId)
    if (!reward) return { fulfilled: false }

    await rewardStore.updateStatus(reward.id, 'fulfilled')
    return { fulfilled: true, rewardId: reward.id }
  }

  return { getOrCreateCode, applyReferral, fulfillReward, generateReferralCode }
}

export type ReferralService = ReturnType<typeof createReferralService>
