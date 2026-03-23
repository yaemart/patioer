import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarketContext } from './market-context.js'
import { _resetCurrencyRedis } from './currency.js'

afterEach(() => {
  _resetCurrencyRedis()
  vi.restoreAllMocks()
})

describe('createMarketContext', () => {
  it('createMarketContext returns object with all 5 methods', () => {
    const ctx = createMarketContext()

    expect(typeof ctx.convertPrice).toBe('function')
    expect(typeof ctx.calculateTax).toBe('function')
    expect(typeof ctx.checkCompliance).toBe('function')
    expect(typeof ctx.isProhibited).toBe('function')
    expect(typeof ctx.getRequiredCertifications).toBe('function')
  })

  it('ctx.calculateTax delegates to tax module correctly', () => {
    const ctx = createMarketContext()

    const result = ctx.calculateTax(100, 'SG')

    expect(result.taxAmount).toBe(9)
    expect(result.totalAmount).toBe(109)
    expect(result.taxRate.name).toBe('GST')
  })

  it('ctx.checkCompliance delegates to compliance module correctly', () => {
    const ctx = createMarketContext()

    const result = ctx.checkCompliance({
      category: 'electronics',
      market: 'SG',
      hasElectronics: true,
      hasFood: false,
      hasCosme: false,
    })

    expect(result.compliant).toBe(true)
    expect(result.requiredCertifications).toContain('IMDA')
  })

  it('ctx.isProhibited returns correct result for prohibited category', () => {
    const ctx = createMarketContext()

    expect(ctx.isProhibited('controlled-drugs', 'SG')).toBe(true)
    expect(ctx.isProhibited('electronics', 'SG')).toBe(false)
  })

  it('createMarketContext with redis injects client into currency module', async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { USD: 0.74 }, date: '2026-03-22' }),
      }),
    )

    const ctx = createMarketContext({ redis: mockRedis })
    await ctx.convertPrice(100, 'SGD', 'USD')

    // Redis.set should have been called to cache the result
    expect(mockRedis.set).toHaveBeenCalledOnce()
  })

  it('ctx.convertPrice SGD to USD returns valid number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { USD: 0.741234 }, date: '2026-03-22' }),
      }),
    )

    const ctx = createMarketContext()
    const result = await ctx.convertPrice(100, 'SGD', 'USD')

    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
    expect(result).toBeCloseTo(74.1234, 3)
  })
})
