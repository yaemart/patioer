import type { FastifyRequest } from 'fastify'
import type { TenantHarness } from '@patioer/harness'
import { HarnessError } from '@patioer/harness'
import { getOrCreateHarnessFromCredential } from './harness-from-credential.js'
import { registry } from './harness-registry.js'
import type { SupportedPlatform } from './harness-factory.js'
import { resolveFirstCredential } from './resolve-credential.js'

export type ResolveHarnessResult =
  | { ok: true; harness: TenantHarness; platform: SupportedPlatform; registryKey: string }
  | { ok: false; statusCode: number; body: { error: string } }

export async function resolveHarness(
  request: FastifyRequest,
  preferredPlatform?: SupportedPlatform | null,
): Promise<ResolveHarnessResult> {
  if (!request.withDb || !request.tenantId) {
    return { ok: false, statusCode: 401, body: { error: 'x-tenant-id required' } }
  }

  const resolved = await resolveFirstCredential(request, preferredPlatform)
  if (!resolved) {
    return { ok: false, statusCode: 404, body: { error: 'No platform credentials found' } }
  }

  const { cred, platform } = resolved
  const registryKey = `${request.tenantId}:${platform}`

  try {
    const harness = getOrCreateHarnessFromCredential(request.tenantId!, platform, {
      accessToken: cred.accessToken,
      shopDomain: cred.shopDomain,
      region: cred.region,
      metadata: cred.metadata,
    })
    return { ok: true, harness, platform, registryKey }
  } catch {
    return { ok: false, statusCode: 503, body: { error: 'Platform integration not configured' } }
  }
}

export interface HarnessErrorResponse {
  statusCode: number
  body: { error: string }
}

/**
 * Maps a HarnessError to an HTTP response, including registry invalidation on 401.
 */
export function handleHarnessError(
  err: HarnessError,
  platform: SupportedPlatform,
  registryKey: string,
  fallbackMessage: string,
): HarnessErrorResponse {
  if (err.code === '401') {
    registry.invalidate(registryKey)
    return { statusCode: 503, body: { error: `${platform} authorization expired; please reconnect` } }
  }
  if (err.code === '429') {
    return { statusCode: 429, body: { error: `${platform} rate limit exceeded; retry later` } }
  }
  return { statusCode: 502, body: { error: fallbackMessage } }
}
