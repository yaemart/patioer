import { afterEach, describe, expect, it } from 'vitest'
import { TokenBucket, jitteredBackoff, getSharedBucket, resetSharedBuckets } from './token-bucket.js'

afterEach(() => {
  resetSharedBuckets()
})

describe('TokenBucket', () => {
  it('throws when refillRatePerSecond is zero', () => {
    expect(() => new TokenBucket(2, 0)).toThrow('refillRatePerSecond must be > 0')
  })

  it('throws when capacity is zero', () => {
    expect(() => new TokenBucket(0, 1)).toThrow('capacity must be > 0')
  })

  it('allows bursts up to capacity', async () => {
    const bucket = new TokenBucket(3, 1)
    await bucket.acquire()
    await bucket.acquire()
    await bucket.acquire()
  })

  it('accepts a custom nowFn for deterministic testing', async () => {
    let now = 1000
    const bucket = new TokenBucket(1, 1, () => now)
    await bucket.acquire()
    now += 1001
    await bucket.acquire()
  })
})

describe('jitteredBackoff', () => {
  it('returns a value within [0, baseDelay * 2^attempt]', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = jitteredBackoff(attempt, 500)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(500 * 2 ** attempt)
    }
  })
})

describe('getSharedBucket', () => {
  it('returns same bucket for same key', () => {
    const a = getSharedBucket('shop.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    const b = getSharedBucket('shop.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    expect(a).toBe(b)
  })

  it('returns different bucket for different key', () => {
    const a = getSharedBucket('shop-a.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    const b = getSharedBucket('shop-b.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    expect(a).not.toBe(b)
  })

  it('resetSharedBuckets clears all entries', () => {
    const a = getSharedBucket('shop.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    resetSharedBuckets()
    const b = getSharedBucket('shop.myshopify.com', { capacity: 2, refillRatePerSecond: 2 })
    expect(a).not.toBe(b)
  })
})
