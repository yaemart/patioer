import type { NpsResponse } from './growth.types.js'

export type NpsCategory = 'promoter' | 'passive' | 'detractor'

export interface NpsTenantInfo {
  tenantId: string
  registeredAt: Date
  email: string
}

export interface NpsStore {
  hasReceivedNps(tenantId: string): Promise<boolean>
  recordResponse(response: Omit<NpsResponse, 'createdAt'>): Promise<void>
  getResponses(tenantId: string): Promise<NpsResponse[]>
}

export interface NpsEmailSender {
  send(params: { to: string; subject: string; body: string }): Promise<void>
}

export interface NpsServiceDeps {
  store: NpsStore
  email: NpsEmailSender
  generateId: () => string
}

const NPS_TRIGGER_DAYS = 30

export function classifyNps(score: number): NpsCategory {
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

export function createNpsService(deps: NpsServiceDeps) {
  const { store, email, generateId } = deps

  async function checkAndSendNps(tenant: NpsTenantInfo): Promise<boolean> {
    const daysSinceRegistration = Math.floor(
      (Date.now() - tenant.registeredAt.getTime()) / (1000 * 60 * 60 * 24),
    )

    if (daysSinceRegistration < NPS_TRIGGER_DAYS) return false

    const alreadySent = await store.hasReceivedNps(tenant.tenantId)
    if (alreadySent) return false

    await email.send({
      to: tenant.email,
      subject: '[ElectroOS] How are we doing? Quick 1-minute survey',
      body: [
        'You have been using ElectroOS for 30 days!',
        'On a scale of 0-10, how likely are you to recommend ElectroOS to a friend?',
        'Reply to this email or visit your dashboard to submit feedback.',
      ].join('\n'),
    })

    return true
  }

  async function recordNpsResponse(
    tenantId: string,
    score: number,
    feedback: string | null,
  ): Promise<NpsResponse> {
    if (score < 0 || score > 10 || !Number.isInteger(score)) {
      throw new Error('NPS score must be an integer between 0 and 10')
    }

    const response: NpsResponse = {
      id: generateId(),
      tenantId,
      score,
      feedback,
      createdAt: new Date(),
    }

    await store.recordResponse(response)
    return response
  }

  async function getResponses(tenantId: string): Promise<NpsResponse[]> {
    return store.getResponses(tenantId)
  }

  async function calculateNpsScore(tenantIds?: string[]): Promise<{
    promoters: number
    passives: number
    detractors: number
    npsScore: number
    total: number
  }> {
    const allResponses: NpsResponse[] = []
    if (tenantIds) {
      for (const tid of tenantIds) {
        const responses = await store.getResponses(tid)
        allResponses.push(...responses)
      }
    }

    let promoters = 0
    let passives = 0
    let detractors = 0

    for (const r of allResponses) {
      const cat = classifyNps(r.score)
      if (cat === 'promoter') promoters++
      else if (cat === 'passive') passives++
      else detractors++
    }

    const total = allResponses.length
    const npsScore = total === 0
      ? 0
      : Math.round(((promoters - detractors) / total) * 100)

    return { promoters, passives, detractors, npsScore, total }
  }

  return { checkAndSendNps, recordNpsResponse, getResponses, calculateNpsScore, classifyNps }
}

export type NpsService = ReturnType<typeof createNpsService>
