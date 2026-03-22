export interface TokenBucketConfig {
  capacity: number
  refillRatePerSecond: number
}

/**
 * Leaky token-bucket rate limiter shared across harness implementations.
 * Accepts an optional `nowFn` for deterministic time control in tests.
 */
export class TokenBucket {
  private tokens: number
  private lastRefillMs: number

  constructor(
    private readonly capacity: number,
    private readonly refillRatePerSecond: number,
    private readonly nowFn: () => number = Date.now,
  ) {
    if (refillRatePerSecond <= 0) {
      throw new Error(`TokenBucket refillRatePerSecond must be > 0, got ${refillRatePerSecond}`)
    }
    if (capacity <= 0) {
      throw new Error(`TokenBucket capacity must be > 0, got ${capacity}`)
    }
    this.tokens = capacity
    this.lastRefillMs = this.nowFn()
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = this.nowFn()
      const elapsed = (now - this.lastRefillMs) / 1000
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSecond)
      this.lastRefillMs = now

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      const waitMs = Math.ceil(((1 - this.tokens) / this.refillRatePerSecond) * 1000)
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

/**
 * Full-jitter exponential backoff: random value in [0, cap].
 * Prevents synchronized retry storms across tenants.
 */
export function jitteredBackoff(attempt: number, baseDelayMs: number): number {
  const cap = baseDelayMs * 2 ** attempt
  return Math.random() * cap
}

interface SharedBucketEntry {
  bucket: TokenBucket
  lastUsedAt: number
}

const BUCKET_IDLE_TTL_MS = 30 * 60 * 1000
const sharedBuckets = new Map<string, SharedBucketEntry>()

/**
 * Returns a per-domain shared TokenBucket, pruning idle entries.
 * Used by ShopifyHarness so concurrent requests to the same shop share a single bucket.
 */
export function getSharedBucket(
  key: string,
  config: TokenBucketConfig,
  nowFn: () => number = Date.now,
): TokenBucket {
  const now = nowFn()
  for (const [domain, entry] of sharedBuckets.entries()) {
    if (now - entry.lastUsedAt > BUCKET_IDLE_TTL_MS) {
      sharedBuckets.delete(domain)
    }
  }

  let entry = sharedBuckets.get(key)
  if (!entry) {
    entry = {
      bucket: new TokenBucket(config.capacity, config.refillRatePerSecond, nowFn),
      lastUsedAt: now,
    }
    sharedBuckets.set(key, entry)
  }
  entry.lastUsedAt = now
  return entry.bucket
}

/** Clears all shared buckets. Exported for test isolation. */
export function resetSharedBuckets(): void {
  sharedBuckets.clear()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
