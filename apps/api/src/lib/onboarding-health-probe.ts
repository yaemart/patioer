import type { FastifyBaseLogger } from 'fastify'
import { HarnessError } from '@patioer/harness'
import type { AppDb } from '@patioer/db'
import { schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import { getOrCreateHarnessFromCredential } from './harness-from-credential.js'
import { registry } from './harness-registry.js'
import { listEnabledPlatformsFromDb, queryCredentialForPlatform } from './resolve-credential.js'
import type { SupportedPlatform } from './harness-factory.js'
import { probeAgentExecution } from './agent-execute-probe.js'

const DEFAULT_PROBE_TIMEOUT_MS = 15_000

export interface PlatformProbeRow {
  platform: string
  ok: boolean
  probe?: string
  error?: string
}

export interface AgentHeartbeatRow {
  agentType: string
  agentId: string
  ok: boolean
  probe: string
  platform?: string
  error?: string
}

export interface OnboardingHealthResult {
  ok: boolean
  tenantId: string
  platforms: PlatformProbeRow[]
  agentHeartbeat: AgentHeartbeatRow
  agents: {
    count: number
    types: string[]
    expectedMin: number
    meetsMinimum: boolean
  }
  paperclip: {
    configured: boolean
  }
  summary: {
    heartbeatOk: boolean
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error('probe_timeout')), ms)
    }),
  ])
}

function paperclipEnvConfigured(): boolean {
  return Boolean(process.env.PAPERCLIP_API_URL && process.env.PAPERCLIP_API_KEY)
}

/**
 * Per enabled platform `getProducts({ limit: 1 })`, execute-pipeline heartbeat probe, agent count.
 * Single-platform failure visible in `platforms[]`; overall `ok` requires all probes green,
 * agents >= minimum, and execute probe success.
 */
export async function runOnboardingHealthProbe(params: {
  tenantId: string
  withDb: <T>(cb: (db: AppDb) => Promise<T>) => Promise<T>
  log: FastifyBaseLogger
  probeTimeoutMs?: number
  expectedAgentMin?: number
}): Promise<OnboardingHealthResult> {
  const probeTimeoutMs = params.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const expectedMin = params.expectedAgentMin ?? 5

  const platforms = await params.withDb((db) => listEnabledPlatformsFromDb(db, params.tenantId))

  const platformRows: PlatformProbeRow[] = []

  for (const platform of platforms) {
    const cred = await params.withDb((db) =>
      queryCredentialForPlatform(db, params.tenantId, platform as SupportedPlatform),
    )
    if (!cred) {
      platformRows.push({ platform, ok: false, error: 'credential_missing' })
      continue
    }

    let harness: ReturnType<typeof getOrCreateHarnessFromCredential>
    try {
      harness = getOrCreateHarnessFromCredential(params.tenantId, platform as SupportedPlatform, {
        accessToken: cred.accessToken,
        shopDomain: cred.shopDomain,
        region: cred.region,
        metadata: cred.metadata,
      })
    } catch (err) {
      params.log.warn({ err, platform }, 'onboarding.health.harness_init_failed')
      platformRows.push({
        platform,
        ok: false,
        error: err instanceof Error ? err.message : 'harness_init_failed',
      })
      continue
    }

    try {
      await withTimeout(harness.getProducts({ limit: 1 }), probeTimeoutMs)
      platformRows.push({ platform, ok: true, probe: 'getProducts:1' })
    } catch (err) {
      if (err instanceof HarnessError && err.code === '401') {
        registry.invalidate(`${params.tenantId}:${platform}`)
      }
      const message = err instanceof Error ? err.message : String(err)
      params.log.warn({ err, platform }, 'onboarding.health.probe_failed')
      platformRows.push({
        platform,
        ok: false,
        error: message,
      })
    }
  }

  const typeRows = await params.withDb((db) =>
    db
      .select({ type: schema.agents.type })
      .from(schema.agents)
      .where(eq(schema.agents.tenantId, params.tenantId)),
  )
  const types = typeRows.map((r) => r.type)
  const meetsMinimum = typeRows.length >= expectedMin

  const platformFailures = platformRows.filter((p) => !p.ok).length
  const platformsOk = platformRows.length > 0 && platformFailures === 0

  const executeProbe = await probeAgentExecution({
    tenantId: params.tenantId,
    withDb: params.withDb,
    log: params.log,
  })

  const heartbeat: AgentHeartbeatRow = {
    agentType: executeProbe.agentType || '_',
    agentId: executeProbe.agentId,
    ok: executeProbe.ok,
    probe: executeProbe.probe,
    platform: executeProbe.platform,
    error: executeProbe.error,
  }

  const overallOk = platformsOk && meetsMinimum && executeProbe.ok

  return {
    ok: overallOk,
    tenantId: params.tenantId,
    platforms: platformRows,
    agentHeartbeat: heartbeat,
    agents: {
      count: typeRows.length,
      types,
      expectedMin,
      meetsMinimum,
    },
    paperclip: {
      configured: paperclipEnvConfigured(),
    },
    summary: {
      heartbeatOk: executeProbe.ok,
    },
  }
}
