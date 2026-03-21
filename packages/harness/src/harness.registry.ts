import type { TenantHarness } from './base.harness.js'

/**
 * Caches one TenantHarness per composite key (typically `tenantId:platform`).
 * Ensures the TokenBucket rate limiter is shared across requests.
 */
export class HarnessRegistry {
  private readonly cache = new Map<string, TenantHarness>()

  getOrCreate(key: string, factory: () => TenantHarness): TenantHarness {
    let harness = this.cache.get(key)
    if (!harness) {
      harness = factory()
      this.cache.set(key, harness)
    }
    return harness
  }
}
