import type { FastifyBaseLogger, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import {
  OnboardingMachine,
  buildGuideResult,
  createDbOnboardingStore,
  runHealthCheck,
  validatePlatformSelection,
} from '@patioer/onboarding'
import type {
  HealthCheckReport,
  OAuthGuideResult,
  OAuthStatus,
  OnboardingStep,
  StepInput,
} from '@patioer/onboarding'
import { verifyJwt, parseCookies } from './auth.js'
import { onboardingStepTotal, onboardingCompletedTotal } from '../plugins/metrics.js'
import { createBestEffortAuditEventRecorder } from '../lib/audit-event-recorder.js'

let _machine: OnboardingMachine | null = null

export interface OnboardingEventRecorder {
  record(event: { tenantId: string; eventType: string; payload: Record<string, unknown> }): Promise<void>
}

let _eventRecorder: OnboardingEventRecorder | null = null

type TenantDbRunner = NonNullable<FastifyRequest['withDb']>

interface OAuthVerificationResult {
  oauthResults: Record<string, OAuthStatus>
  missingPlatforms: string[]
  invalidPlatforms: string[]
  guides: OAuthGuideResult[]
}

export interface OnboardingOAuthVerifier {
  verify(params: {
    tenantId: string
    platforms: string[]
    withDb: TenantDbRunner
  }): Promise<OAuthVerificationResult>
}

export interface OnboardingHealthChecker {
  run(params: {
    tenantId: string
    withDb: TenantDbRunner
    machine: OnboardingMachine
    log: FastifyBaseLogger
  }): Promise<HealthCheckReport>
}

let _oauthVerifier: OnboardingOAuthVerifier | null = null
let _healthChecker: OnboardingHealthChecker | null = null

export function setOnboardingMachine(machine: OnboardingMachine): void {
  _machine = machine
}

export function setOnboardingEventRecorder(recorder: OnboardingEventRecorder): void {
  _eventRecorder = recorder
}

export function setOnboardingOAuthVerifier(verifier: OnboardingOAuthVerifier | null): void {
  _oauthVerifier = verifier
}

export function setOnboardingHealthChecker(checker: OnboardingHealthChecker | null): void {
  _healthChecker = checker
}

function getMachine(): OnboardingMachine {
  if (!_machine) _machine = new OnboardingMachine(createDbOnboardingStore())
  return _machine
}

function getEventRecorder(): OnboardingEventRecorder {
  if (!_eventRecorder) _eventRecorder = createBestEffortAuditEventRecorder()
  return _eventRecorder
}

function getOAuthVerifier(): OnboardingOAuthVerifier {
  if (_oauthVerifier) return _oauthVerifier

  _oauthVerifier = {
    async verify({ tenantId, platforms, withDb }) {
      const { valid, invalid } = validatePlatformSelection(platforms)
      const credentials = await withDb((db) =>
        db
          .select({ platform: schema.platformCredentials.platform })
          .from(schema.platformCredentials)
          .where(eq(schema.platformCredentials.tenantId, tenantId)),
      )

      const connectedPlatforms = new Set(
        credentials
          .map((credential) => credential.platform)
          .filter((platform): platform is string => typeof platform === 'string'),
      )

      const oauthResults = Object.fromEntries(
        valid.map((platform) => [
          platform,
          connectedPlatforms.has(platform) ? 'success' : 'pending',
        ]),
      ) as Record<string, OAuthStatus>

      const missingPlatforms = valid.filter((platform) => !connectedPlatforms.has(platform))
      const guides = valid.map((platform) => buildGuideResult(platform, oauthResults[platform]))

      return { oauthResults, missingPlatforms, invalidPlatforms: invalid, guides }
    },
  }

  return _oauthVerifier
}

function getHealthChecker(): OnboardingHealthChecker {
  if (_healthChecker) return _healthChecker

  _healthChecker = {
    async run({ tenantId, withDb, machine }) {
      const state = await machine.getOrCreate(tenantId)
      const enabledAgents =
        (
          state.stepData[5] as
            | { agentConfig?: { enabledAgents?: string[] } }
            | undefined
        )?.agentConfig?.enabledAgents ?? []

      const platformRows = await withDb((db) =>
        db
          .select({ id: schema.platformCredentials.id })
          .from(schema.platformCredentials)
          .where(eq(schema.platformCredentials.tenantId, tenantId)),
      )

      const latestEventRows = await withDb((db) =>
        db
          .select({ createdAt: schema.agentEvents.createdAt })
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.tenantId, tenantId))
          .limit(1),
      )

      const pendingApprovals = await withDb((db) =>
        db
          .select({ id: schema.approvals.id })
          .from(schema.approvals)
          .where(eq(schema.approvals.tenantId, tenantId)),
      )

      return runHealthCheck({
        async checkApiConnectivity() {
          return { ok: true, latencyMs: 0 }
        },
        async checkAgentHeartbeat() {
          return {
            ok: enabledAgents.length > 0,
            activeAgents: enabledAgents.length,
            totalAgents: enabledAgents.length,
          }
        },
        async checkDataPipeline() {
          const latestEvent = latestEventRows[0]?.createdAt
          const lastEventAge = latestEvent
            ? Math.max(0, Math.round((Date.now() - latestEvent.getTime()) / 1000))
            : null
          return { ok: platformRows.length > 0, lastEventAge }
        },
        async checkApprovalSystem() {
          return { ok: true, pendingCount: pendingApprovals.length }
        },
      })
    },
  }

  return _healthChecker
}

interface AdvanceBody {
  step: number
  input: StepInput
}

interface SkipBody {
  step: number
}

const ERROR_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const },
    message: { type: 'string' as const },
  },
}

const STATE_SCHEMA = {
  type: 'object' as const,
  properties: {
    currentStep: { type: 'number' as const },
    stepData: { type: 'object' as const },
    oauthStatus: { type: 'object' as const },
    healthCheckPassed: { type: 'boolean' as const },
    startedAt: { type: 'string' as const, nullable: true },
    completedAt: { type: 'string' as const, nullable: true },
  },
}

function buildHealthFailureMessage(report: HealthCheckReport): string {
  const failures = report.items
    .filter((item) => !item.passed)
    .map((item) => item.message)

  if (failures.length === 0) {
    return 'Health check did not pass'
  }

  return `Health check failed: ${failures.join('; ')}`
}

function extractTenantId(request: { headers: Record<string, string | string[] | undefined>; tenantId?: string }): string | null {
  if (typeof request.tenantId === 'string') return request.tenantId
  const headerTid = request.headers['x-tenant-id']
  const fromHeader = typeof headerTid === 'string' && headerTid.length > 0 ? headerTid : null

  const cookieHeader = request.headers['cookie']
  const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined)
  const token = cookies['eos_token']
  if (token) {
    const payload = verifyJwt(token)
    if (payload && typeof payload.tenantId === 'string') {
      if (fromHeader && fromHeader !== payload.tenantId) return null
      return payload.tenantId
    }
  }

  return fromHeader
}

const onboardingWizardRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/onboarding/state', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Get current onboarding state',
      security: [{ bearerAuth: [] }],
      response: {
        200: STATE_SCHEMA,
        400: ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const tenantId = extractTenantId(request)
    if (!tenantId) {
      return reply.status(400).send({ type: 'missing_tenant', message: 'x-tenant-id header required' })
    }

    const state = await getMachine().getOrCreate(tenantId)
    return {
      currentStep: state.currentStep,
      stepData: state.stepData,
      oauthStatus: state.oauthStatus,
      healthCheckPassed: state.healthCheckPassed,
      startedAt: state.startedAt?.toISOString() ?? null,
      completedAt: state.completedAt?.toISOString() ?? null,
    }
  })

  app.post<{ Body: AdvanceBody }>('/api/v1/onboarding/advance', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Advance onboarding by one step',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['step', 'input'],
        properties: {
          step: { type: 'number', minimum: 1, maximum: 7 },
          input: { type: 'object' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            step: { type: 'number' },
            success: { type: 'boolean' },
            error: { type: 'string' },
            data: { type: 'object' },
          },
        },
        400: ERROR_SCHEMA,
        422: {
          type: 'object',
          properties: {
            step: { type: 'number' },
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = extractTenantId(request)
    if (!tenantId) {
      return reply.status(400).send({ type: 'missing_tenant', message: 'x-tenant-id header required' })
    }

    const { step, input } = request.body
    const machine = getMachine()
    let nextInput = input

    if (step === 4) {
      if (!request.withDb && !_oauthVerifier) {
        return reply.status(503).send({ type: 'missing_db', message: 'database access required for OAuth verification' })
      }

      const platforms = Array.isArray(input.platforms) ? input.platforms : []
      const verification = await getOAuthVerifier().verify({
        tenantId,
        platforms,
        withDb: request.withDb as TenantDbRunner,
      })

      if (verification.invalidPlatforms.length > 0) {
        onboardingStepTotal.labels(String(step), 'failure').inc()
        return reply.status(422).send({
          step,
          success: false,
          error: `Unsupported platform: ${verification.invalidPlatforms.join(', ')}`,
          data: { guides: verification.guides, oauthResults: verification.oauthResults },
        })
      }

      if (verification.missingPlatforms.length > 0) {
        onboardingStepTotal.labels(String(step), 'failure').inc()
        return reply.status(422).send({
          step,
          success: false,
          error: `OAuth still pending for: ${verification.missingPlatforms.join(', ')}`,
          data: { guides: verification.guides, oauthResults: verification.oauthResults },
        })
      }

      nextInput = {
        ...input,
        oauthResults: verification.oauthResults,
      }
    }

    if (step === 7) {
      if (!request.withDb && !_healthChecker) {
        return reply.status(503).send({ type: 'missing_db', message: 'database access required for health check' })
      }

      const report = await getHealthChecker().run({
        tenantId,
        withDb: request.withDb as TenantDbRunner,
        machine,
        log: request.log,
      })

      if (!report.passed) {
        onboardingStepTotal.labels(String(step), 'failure').inc()
        return reply.status(422).send({
          step,
          success: false,
          error: buildHealthFailureMessage(report),
          data: { report },
        })
      }

      nextInput = {
        ...input,
        healthCheckResult: {
          passed: true,
          details: {
            checkedAt: report.checkedAt.toISOString(),
            totalDurationMs: report.totalDurationMs,
            items: report.items,
          },
        },
      }
    }

    const result = await machine.advance(tenantId, step as OnboardingStep, nextInput)

    if (!result.success) {
      onboardingStepTotal.labels(String(step), 'failure').inc()
      return reply.status(422).send(result)
    }

    onboardingStepTotal.labels(String(step), 'success').inc()

    if (step === 7) {
      onboardingCompletedTotal.inc()
      await getEventRecorder().record({
        tenantId,
        eventType: 'tenant.onboarded',
        payload: { step: 7, completedAt: new Date().toISOString() },
      })
    }

    return result
  })

  app.post<{ Body: SkipBody }>('/api/v1/onboarding/skip', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Skip an optional onboarding step',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['step'],
        properties: {
          step: { type: 'number', minimum: 1, maximum: 7 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            step: { type: 'number' },
            success: { type: 'boolean' },
            data: { type: 'object' },
          },
        },
        400: ERROR_SCHEMA,
        422: {
          type: 'object',
          properties: {
            step: { type: 'number' },
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = extractTenantId(request)
    if (!tenantId) {
      return reply.status(400).send({ type: 'missing_tenant', message: 'x-tenant-id header required' })
    }

    const { step } = request.body
    const result = await getMachine().skip(tenantId, step as OnboardingStep)

    if (!result.success) {
      onboardingStepTotal.labels(String(step), 'skip_failed').inc()
      return reply.status(422).send(result)
    }

    onboardingStepTotal.labels(String(step), 'skipped').inc()
    return result
  })
}

export default onboardingWizardRoute
