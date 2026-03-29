import type { FastifyPluginAsync } from 'fastify'
import {
  createDbNpsStore,
  createDbReferralStore,
  createDbRewardStore,
} from '@patioer/growth'
import { createBestEffortAuditEventRecorder } from '../lib/audit-event-recorder.js'

interface ReferralCodeStore {
  findByCode(code: string): Promise<{ id: string; tenantId: string; code: string } | null>
  findByTenantId(tenantId: string): Promise<{ code: string } | null>
  create(entry: { id: string; tenantId: string; code: string; createdAt: Date }): Promise<void>
}

interface RewardStore {
  create(entry: {
    id: string
    referrerTenantId: string
    newTenantId: string
    rewardType: string
    status: string
    createdAt: Date
  }): Promise<void>
}

interface NpsStore {
  hasReceivedNps(tenantId: string): Promise<boolean>
  recordResponse(response: {
    id: string
    tenantId: string
    score: number
    feedback: string | null
  }): Promise<void>
}

interface GrowthEventRecorder {
  record(event: {
    tenantId: string
    eventType: string
    payload: Record<string, unknown>
  }): Promise<void>
}

let _referralCodeStore: ReferralCodeStore | null = null
let _rewardStore: RewardStore | null = null
let _npsStore: NpsStore | null = null
let _eventRecorder: GrowthEventRecorder | null = null

export function setGrowthDeps(deps: {
  referralCodeStore?: ReferralCodeStore
  rewardStore?: RewardStore
  npsStore?: NpsStore
  eventRecorder?: GrowthEventRecorder
}): void {
  if (deps.referralCodeStore) _referralCodeStore = deps.referralCodeStore
  if (deps.rewardStore) _rewardStore = deps.rewardStore
  if (deps.npsStore) _npsStore = deps.npsStore
  if (deps.eventRecorder) _eventRecorder = deps.eventRecorder
}

function getReferralCodeStore(): ReferralCodeStore {
  if (!_referralCodeStore) _referralCodeStore = createDbReferralStore()
  return _referralCodeStore
}

function getRewardStore(): RewardStore {
  if (!_rewardStore) _rewardStore = createDbRewardStore()
  return _rewardStore
}

function getNpsStore(): NpsStore {
  if (!_npsStore) _npsStore = createDbNpsStore()
  return _npsStore
}

function getEventRecorder(): GrowthEventRecorder {
  if (!_eventRecorder) _eventRecorder = createBestEffortAuditEventRecorder()
  return _eventRecorder
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `ELEC-${suffix}`
}

const growthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/growth/referral-code', {
    schema: {
      tags: ['Growth'],
      summary: 'Get or create the current tenant referral code',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId
    if (!tenantId) return reply.status(401).send({ message: 'Authentication required' })

    const existing = await getReferralCodeStore().findByTenantId(tenantId)
    if (existing) return reply.send({ code: existing.code })

    const code = generateCode()
    await getReferralCodeStore().create({
      id: crypto.randomUUID(),
      tenantId,
      code,
      createdAt: new Date(),
    })

    await getEventRecorder().record({
      tenantId,
      eventType: 'growth.referral_code_generated',
      payload: { code },
    })

    return reply.send({ code })
  })

  app.post<{ Body: { code: string } }>(
    '/api/v1/growth/apply-referral',
    {
      schema: {
        tags: ['Growth'],
        summary: 'Apply a referral code for the current tenant',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const tenantId = request.tenantId
      if (!tenantId) return reply.status(401).send({ message: 'Authentication required' })

      const { code } = request.body
      if (!code) return reply.status(400).send({ message: 'Referral code required' })

      const referral = await getReferralCodeStore().findByCode(code)
      if (!referral) return reply.status(404).send({ message: 'Invalid referral code' })

      if (referral.tenantId === tenantId) {
        return reply.status(400).send({ message: 'Cannot use your own referral code' })
      }

      await getRewardStore().create({
        id: crypto.randomUUID(),
        referrerTenantId: referral.tenantId,
        newTenantId: tenantId,
        rewardType: '20_pct_discount_1_month',
        status: 'pending',
        createdAt: new Date(),
      })

      await getEventRecorder().record({
        tenantId,
        eventType: 'growth.referral_applied',
        payload: {
          code,
          referrerTenantId: referral.tenantId,
        },
      })

      return reply.send({
        applied: true,
        referrerTenantId: referral.tenantId,
      })
    },
  )

  app.post<{ Body: { score: number; feedback?: string } }>(
    '/api/v1/growth/nps',
    {
      schema: {
        tags: ['Growth'],
        summary: 'Submit an NPS response for the current tenant',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const tenantId = request.tenantId
      if (!tenantId) return reply.status(401).send({ message: 'Authentication required' })

      const { score, feedback } = request.body
      if (typeof score !== 'number' || score < 0 || score > 10 || !Number.isInteger(score)) {
        return reply.status(400).send({ message: 'Score must be an integer 0-10' })
      }

      await getNpsStore().recordResponse({
        id: crypto.randomUUID(),
        tenantId,
        score,
        feedback: feedback ?? null,
      })

      await getEventRecorder().record({
        tenantId,
        eventType: 'growth.nps_submitted',
        payload: {
          score,
          hasFeedback: typeof feedback === 'string' && feedback.length > 0,
        },
      })

      return reply.send({ recorded: true })
    },
  )
}

export default growthRoute
