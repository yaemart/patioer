import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import {
  createDbNpsStore,
  createDbReferralStore,
  createDbRewardStore,
  createNpsService,
  createReferralService,
  type NpsService,
  type ReferralService,
} from '@patioer/growth'
import { createBestEffortAuditEventRecorder } from '../lib/audit-event-recorder.js'

interface GrowthEventRecorder {
  record(event: {
    tenantId: string
    eventType: string
    payload: Record<string, unknown>
  }): Promise<void>
}

type GrowthReferralService = Pick<ReferralService, 'getOrCreateCode' | 'applyReferral'>
type GrowthNpsService = Pick<NpsService, 'recordNpsResponse'>

let _referralService: GrowthReferralService | null = null
let _npsService: GrowthNpsService | null = null
let _eventRecorder: GrowthEventRecorder | null = null

export function setGrowthDeps(deps: {
  referralService?: GrowthReferralService
  npsService?: GrowthNpsService
  eventRecorder?: GrowthEventRecorder
}): void {
  if (deps.referralService) _referralService = deps.referralService
  if (deps.npsService) _npsService = deps.npsService
  if (deps.eventRecorder) _eventRecorder = deps.eventRecorder
}

function getReferralService(): GrowthReferralService {
  if (!_referralService) {
    _referralService = createReferralService({
      referralStore: createDbReferralStore(),
      rewardStore: createDbRewardStore(),
      generateId: randomUUID,
    })
  }
  return _referralService
}

function getNpsService(): GrowthNpsService {
  if (!_npsService) {
    _npsService = createNpsService({
      store: createDbNpsStore(),
      email: { send: async () => {} },
      generateId: randomUUID,
    })
  }
  return _npsService
}

function getEventRecorder(): GrowthEventRecorder {
  if (!_eventRecorder) _eventRecorder = createBestEffortAuditEventRecorder()
  return _eventRecorder
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

    const result = await getReferralService().getOrCreateCode(tenantId)
    if (result.created) {
      await getEventRecorder().record({
        tenantId,
        eventType: 'growth.referral_code_generated',
        payload: { code: result.code },
      })
    }

    return reply.send({ code: result.code })
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

      let referralResult: Awaited<ReturnType<GrowthReferralService['applyReferral']>>
      try {
        referralResult = await getReferralService().applyReferral(tenantId, code)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to apply referral'
        if (message.startsWith('Invalid referral code')) {
          return reply.status(404).send({ message: 'Invalid referral code' })
        }
        if (message === 'Cannot use your own referral code') {
          return reply.status(400).send({ message })
        }
        throw error
      }

      await getEventRecorder().record({
        tenantId,
        eventType: 'growth.referral_applied',
        payload: {
          code,
          referrerTenantId: referralResult.referrerTenantId,
        },
      })

      return reply.send({
        applied: true,
        referrerTenantId: referralResult.referrerTenantId,
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
      try {
        await getNpsService().recordNpsResponse(tenantId, score, feedback ?? null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to record NPS response'
        if (message === 'NPS score must be an integer between 0 and 10') {
          return reply.status(400).send({ message: 'Score must be an integer 0-10' })
        }
        throw error
      }

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
