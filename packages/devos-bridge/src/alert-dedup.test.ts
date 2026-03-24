import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAlertDedupStore } from './alert-dedup.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createAlertDedupStore', () => {
  it('returns false for unseen fingerprint', () => {
    const store = createAlertDedupStore()
    expect(store.has('fp-1')).toBe(false)
  })

  it('returns true for seen fingerprint within TTL', () => {
    const store = createAlertDedupStore({ ttlMs: 60_000 })
    store.add('fp-1')
    expect(store.has('fp-1')).toBe(true)
  })

  it('evicts expired fingerprints', () => {
    const store = createAlertDedupStore({ ttlMs: 1000 })
    store.add('fp-1')
    vi.advanceTimersByTime(1500)
    expect(store.has('fp-1')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('evicts oldest when maxSize exceeded', () => {
    const store = createAlertDedupStore({ ttlMs: 60_000, maxSize: 2 })
    store.add('fp-1')
    store.add('fp-2')
    store.add('fp-3')
    expect(store.has('fp-1')).toBe(false)
    expect(store.has('fp-2')).toBe(true)
    expect(store.has('fp-3')).toBe(true)
    expect(store.size).toBe(2)
  })
})
