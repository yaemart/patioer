import type { TenantHarness } from '@patioer/harness'
import { registry } from './harness-registry.js'
import { createHarness, type HarnessCredentialInput, type SupportedPlatform } from './harness-factory.js'

/**
 * Shared path: cache key `tenantId:platform` + {@link createHarness} for DB-backed credentials.
 * Used by agent execute, approval worker, and generic harness resolution.
 */
export function getOrCreateHarnessFromCredential(
  tenantId: string,
  platform: SupportedPlatform,
  cred: HarnessCredentialInput,
): TenantHarness {
  const registryKey = `${tenantId}:${platform}`
  return registry.getOrCreate(registryKey, () =>
    createHarness(tenantId, platform, {
      accessToken: cred.accessToken,
      shopDomain: cred.shopDomain,
      region: cred.region,
      metadata: cred.metadata,
    }),
  )
}
