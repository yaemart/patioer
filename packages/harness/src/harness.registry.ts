import type { TenantHarness } from './base.harness.js'
import type { Platform, HarnessFactory } from './types.js'

const DEFAULT_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 1000

interface CacheEntry {
  harness: TenantHarness
  expiresAt: number
}

/**
 * Caches one TenantHarness per composite key (typically `tenantId:platform`).
 * Ensures the TokenBucket rate limiter is shared across requests.
 */
export class HarnessRegistry {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly nowFn: () => number = Date.now) {}

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) this.cache.delete(key)
    }
  }

  private pruneOverflow(): void {
    const overflow = this.cache.size - DEFAULT_MAX_ENTRIES
    if (overflow <= 0) return
    const keys = this.cache.keys()
    for (let i = 0; i < overflow; i += 1) {
      const first = keys.next()
      if (first.done) break
      this.cache.delete(first.value)
    }
  }

  getOrCreate(key: string, factory: () => TenantHarness): TenantHarness {
    const now = this.nowFn()
    this.pruneExpired(now)

    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > now) {
      cached.expiresAt = now + DEFAULT_TTL_MS
      this.cache.set(key, cached)
      return cached.harness
    }

    const harness = factory()
    this.cache.set(key, { harness, expiresAt: now + DEFAULT_TTL_MS })
    this.pruneOverflow()
    return harness
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}

// ─── Module-level convenience API backed by a shared HarnessRegistry ──────────

/** Platform → factory function registered at app startup. */
const _factories = new Map<Platform, HarnessFactory>()

/** Shared TTL-based registry backing the module-level API. */
const _sharedRegistry = new HarnessRegistry()

/**
 * Register a factory for a platform.
 * Call once per platform during application bootstrap.
 */
export function registerHarnessFactory(platform: Platform, factory: HarnessFactory): void {
  _factories.set(platform, factory)
}

/**
 * Return the TenantHarness for the given tenant + platform combination.
 * Instance is created via registered factory and cached with TTL (15 min).
 * After credential rotation, call `invalidateHarnessInstance` to rebuild on next access.
 */
export function getHarness(tenantId: string, platform: Platform): TenantHarness {
  const key = `${tenantId}:${platform}`
  return _sharedRegistry.getOrCreate(key, () => {
    const factory = _factories.get(platform)
    if (!factory) {
      throw new Error(
        `No harness factory registered for platform "${platform}". ` +
        `Call registerHarnessFactory("${platform}", factory) during bootstrap.`,
      )
    }
    return factory(tenantId)
  })
}

export function clearHarnessInstances(): void {
  _sharedRegistry.clear()
}

export function invalidateHarnessInstance(tenantId: string, platform: Platform): void {
  _sharedRegistry.invalidate(`${tenantId}:${platform}`)
}

/** @internal — test-only: clears both factories and cached instances. */
export function _clearHarnessRegistry(): void {
  _factories.clear()
  _sharedRegistry.clear()
}

export function getRegisteredPlatforms(): Platform[] {
  return [..._factories.keys()]
}
