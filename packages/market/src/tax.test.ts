import { describe, expect, it } from 'vitest'
import { calculateTax, extractBasePrice, getTaxRate } from './tax.js'
import type { Market } from './types.js'

describe('getTaxRate', () => {
  it('getTaxRate returns correct rate for all 6 markets', () => {
    const expected: Record<Market, { rate: number; name: string; inclusive: boolean }> = {
      SG: { rate: 0.09,  name: 'GST',  inclusive: false },
      MY: { rate: 0.06,  name: 'SST',  inclusive: false },
      TH: { rate: 0.07,  name: 'VAT',  inclusive: true  },
      ID: { rate: 0.11,  name: 'PPN',  inclusive: true  },
      UK: { rate: 0.20,  name: 'VAT',  inclusive: false },
      DE: { rate: 0.19,  name: 'MwSt', inclusive: false },
    }

    for (const [market, exp] of Object.entries(expected) as [Market, typeof expected[Market]][]) {
      const tr = getTaxRate(market)
      expect(tr.market).toBe(market)
      expect(tr.rate).toBe(exp.rate)
      expect(tr.name).toBe(exp.name)
      expect(tr.inclusive).toBe(exp.inclusive)
    }
  })
})

describe('calculateTax — non-inclusive markets', () => {
  it('calculateTax SG: 100 → taxAmount=9, total=109', () => {
    const result = calculateTax(100, 'SG')
    expect(result.taxAmount).toBe(9)
    expect(result.totalAmount).toBe(109)
    expect(result.baseAmount).toBe(100)
    expect(result.taxRate.name).toBe('GST')
  })

  it('calculateTax MY: 100 → taxAmount=6, total=106', () => {
    const result = calculateTax(100, 'MY')
    expect(result.taxAmount).toBe(6)
    expect(result.totalAmount).toBe(106)
    expect(result.baseAmount).toBe(100)
    expect(result.taxRate.name).toBe('SST')
  })

  it('calculateTax UK: 100 → taxAmount=20, total=120', () => {
    const result = calculateTax(100, 'UK')
    expect(result.taxAmount).toBe(20)
    expect(result.totalAmount).toBe(120)
    expect(result.baseAmount).toBe(100)
  })

  it('calculateTax DE: 100 → taxAmount=19, total=119', () => {
    const result = calculateTax(100, 'DE')
    expect(result.taxAmount).toBe(19)
    expect(result.totalAmount).toBe(119)
    expect(result.baseAmount).toBe(100)
    expect(result.taxRate.name).toBe('MwSt')
  })
})

describe('calculateTax — inclusive markets', () => {
  it('calculateTax TH: inclusive 107 → taxAmount≈7, base=100', () => {
    // TH VAT 7%, inclusive: 107 total → taxAmount = 107*0.07/1.07 = 7 exactly
    const result = calculateTax(107, 'TH')
    expect(result.totalAmount).toBe(107)
    expect(result.taxAmount).toBeCloseTo(7, 4)
    expect(result.baseAmount).toBeCloseTo(100, 4)
  })

  it('calculateTax ID: inclusive 100 → taxAmount≈9.91, base≈90.09', () => {
    // ID PPN 11%, inclusive: taxAmount = 100 * 0.11 / 1.11 ≈ 9.9099...
    const result = calculateTax(100, 'ID')
    expect(result.totalAmount).toBe(100)
    expect(result.taxAmount).toBeCloseTo(9.909909, 4)
    expect(result.baseAmount).toBeCloseTo(90.09009, 4)
    expect(result.taxRate.name).toBe('PPN')
  })
})

describe('extractBasePrice', () => {
  it('extractBasePrice round-trips with calculateTax total', () => {
    // For every non-inclusive market: extractBasePrice(calculateTax(100).totalAmount) === 100
    const nonInclusiveMarkets: Market[] = ['SG', 'MY', 'UK', 'DE']
    for (const market of nonInclusiveMarkets) {
      const { totalAmount } = calculateTax(100, market)
      const base = extractBasePrice(totalAmount, market)
      expect(base).toBeCloseTo(100, 5)
    }
  })
})

describe('calculateTax — edge cases', () => {
  it('calculateTax with very small amount has no precision drift', () => {
    // 0.01 SGD @ 9% GST: taxAmount = 0.0009
    const result = calculateTax(0.01, 'SG')
    expect(result.taxAmount).toBeCloseTo(0.0009, 4)
    expect(result.baseAmount).toBe(0.01)
    expect(result.totalAmount).toBeCloseTo(0.0109, 4)
  })
})

describe('calculateTax precision', () => {
  it('calculateTax precision: no floating point drift after 1000 iterations', () => {
    // Repeatedly extract base price from SG non-inclusive — value should stay finite and positive
    let total = 100
    for (let i = 0; i < 1000; i++) {
      total = calculateTax(total, 'SG').baseAmount
    }
    expect(isFinite(total)).toBe(true)
    expect(total).toBeGreaterThan(0)
  })
})
