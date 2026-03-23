import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertPrice,
  getExchangeRate,
  setCurrencyRedis,
  _resetCurrencyRedis,
} from './currency.js'

// ─── Shared mock helpers ───────────────────────────────────────────────────────

function makeFetchMock(rate: number, currency = 'USD') {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rates: { [currency]: rate }, date: '2026-03-22' }),
  })
}

function makeRedisMock(cachedValue: string | null = null) {
  return {
    get: vi.fn().mockResolvedValue(cachedValue),
    set: vi.fn().mockResolvedValue('OK'),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('convertPrice', () => {
  beforeEach(() => {
    _resetCurrencyRedis()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('convertPrice returns same amount when from === to', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await convertPrice(100, 'SGD', 'SGD')

    expect(result).toBe(100)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('convertPrice SGD to USD precision within 0.01% of expected', async () => {
    const mockRate = 0.741234
    vi.stubGlobal('fetch', makeFetchMock(mockRate))

    const result = await convertPrice(100, 'SGD', 'USD')
    const expected = 100 * mockRate
    const error = Math.abs(result - expected) / expected

    expect(error).toBeLessThan(0.0001) // < 0.01%
    expect(result).toBeCloseTo(74.1234, 4)
  })
})

describe('convertPrice — edge cases', () => {
  beforeEach(() => {
    _resetCurrencyRedis()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('convertPrice handles amount=0', async () => {
    // amount=0 with from !== to: 0 * rate = 0, no API call needed mathematically
    // but our impl fetches the rate; result must still be 0
    vi.stubGlobal('fetch', makeFetchMock(0.741234))

    const result = await convertPrice(0, 'SGD', 'USD')

    expect(result).toBe(0)
  })
})

describe('getExchangeRate', () => {
  beforeEach(() => {
    _resetCurrencyRedis()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getExchangeRate fetches from API when cache is empty', async () => {
    const fetchMock = makeFetchMock(0.741234)
    vi.stubGlobal('fetch', fetchMock)
    const redis = makeRedisMock(null) // cache empty
    setCurrencyRedis(redis)

    const result = await getExchangeRate('SGD', 'USD')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.rate).toBe(0.741234)
    expect(result.from).toBe('SGD')
    expect(result.to).toBe('USD')
  })

  it('getExchangeRate returns cached value on second call', async () => {
    const fetchMock = makeFetchMock(0.741234)
    vi.stubGlobal('fetch', fetchMock)

    const cachedPayload = JSON.stringify({
      from: 'SGD',
      to: 'USD',
      rate: 0.741234,
      fetchedAt: new Date().toISOString(),
    })
    const redis = makeRedisMock(cachedPayload) // cache hit
    setCurrencyRedis(redis)

    const result = await getExchangeRate('SGD', 'USD')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.rate).toBe(0.741234)
  })

  it('getExchangeRate sets Redis cache with correct TTL', async () => {
    vi.stubGlobal('fetch', makeFetchMock(0.741234))
    const redis = makeRedisMock(null)
    setCurrencyRedis(redis)

    await getExchangeRate('SGD', 'USD')

    expect(redis.set).toHaveBeenCalledOnce()
    const [key, , expiryMode, ttl] = redis.set.mock.calls[0] as [
      string,
      string,
      string,
      number,
    ]
    expect(key).toBe('market:fx:SGD:USD')
    expect(expiryMode).toBe('EX')
    expect(ttl).toBeGreaterThan(0)
  })

  it('getExchangeRate throws when API returns non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422 }),
    )

    await expect(getExchangeRate('SGD', 'XYZ')).rejects.toThrow('422')
  })

  it('getExchangeRate throws when currency pair not found in response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: {}, date: '2026-03-22' }),
      }),
    )

    await expect(getExchangeRate('SGD', 'USD')).rejects.toThrow('No rate found for SGD→USD')
  })
})
