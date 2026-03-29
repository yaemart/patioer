export interface ReferralCode {
  id: string
  tenantId: string
  code: string
  createdAt: Date
}

export interface ReferralReward {
  id: string
  referrerTenantId: string
  newTenantId: string
  rewardType: string
  status: 'pending' | 'fulfilled' | 'expired'
  createdAt: Date
}

export interface NpsResponse {
  id: string
  tenantId: string
  score: number
  feedback: string | null
  createdAt: Date
}
