import { describe, expect, it } from 'vitest'
import { checkCompliance, getRequiredCertifications, isProhibited } from './compliance.js'
import type { Market } from './types.js'

// ─── Day 4: Prohibited category tests ────────────────────────────────────────

describe('isProhibited', () => {
  it('isProhibited returns true for controlled-drugs in all 6 markets', () => {
    const markets: Market[] = ['SG', 'MY', 'TH', 'ID', 'UK', 'DE']
    for (const market of markets) {
      expect(isProhibited('controlled-drugs', market), `market: ${market}`).toBe(true)
    }
  })

  it('isProhibited returns false for electronics in all 6 markets', () => {
    const markets: Market[] = ['SG', 'MY', 'TH', 'ID', 'UK', 'DE']
    for (const market of markets) {
      expect(isProhibited('electronics', market), `market: ${market}`).toBe(false)
    }
  })

  it('isProhibited returns true for tobacco in SG', () => {
    expect(isProhibited('tobacco', 'SG')).toBe(true)
  })

  it('isProhibited returns false for food-supplements in SG', () => {
    expect(isProhibited('food-supplements', 'SG')).toBe(false)
  })
})

describe('checkCompliance — prohibited categories', () => {
  it('checkCompliance tobacco in SG: compliant=false, issues not empty', () => {
    const result = checkCompliance({
      category: 'tobacco',
      market: 'SG',
      hasElectronics: false,
      hasFood: false,
      hasCosme: false,
    })
    expect(result.compliant).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('tobacco')
    expect(result.issues[0]).toContain('SG')
  })

  it('checkCompliance electronics in SG: compliant=true, IMDA cert required', () => {
    const result = checkCompliance({
      category: 'electronics',
      market: 'SG',
      hasElectronics: true,
      hasFood: false,
      hasCosme: false,
    })
    expect(result.compliant).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.requiredCertifications).toContain('IMDA')
  })

  it('checkCompliance counterfeit-goods in MY: compliant=false', () => {
    const result = checkCompliance({
      category: 'counterfeit-goods',
      market: 'MY',
      hasElectronics: false,
      hasFood: false,
      hasCosme: false,
    })
    expect(result.compliant).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})

// ─── Day 5: Certification requirement tests ──────────────────────────────────

describe('getRequiredCertifications', () => {
  it('getRequiredCertifications electronics in SG returns [IMDA]', () => {
    const certs = getRequiredCertifications('electronics', 'SG')
    expect(certs).toEqual(['IMDA'])
  })

  it('getRequiredCertifications electronics in UK returns [UKCA, WEEE]', () => {
    const certs = getRequiredCertifications('electronics', 'UK')
    expect(certs).toContain('UKCA')
    expect(certs).toContain('WEEE')
    expect(certs).toHaveLength(2)
  })

  it('getRequiredCertifications electronics in DE returns [WEEE]', () => {
    const certs = getRequiredCertifications('electronics', 'DE')
    expect(certs).toEqual(['WEEE'])
  })

  it('getRequiredCertifications cosmetics in ID returns [BPOM]', () => {
    const certs = getRequiredCertifications('cosmetics', 'ID')
    expect(certs).toEqual(['BPOM'])
  })

  it('getRequiredCertifications unknown category returns []', () => {
    const certs = getRequiredCertifications('novelty-items', 'SG')
    expect(certs).toEqual([])
  })
})

describe('checkCompliance — cross-cutting flags', () => {
  it('checkCompliance hasElectronics=true adds WEEE cert in DE', () => {
    const result = checkCompliance({
      category: 'accessories',
      market: 'DE',
      hasElectronics: true,
      hasFood: false,
      hasCosme: false,
    })
    expect(result.compliant).toBe(true)
    expect(result.requiredCertifications).toContain('WEEE')
  })

  it('checkCompliance hasCosme=true in ID adds BPOM cert', () => {
    const result = checkCompliance({
      category: 'fashion',
      market: 'ID',
      hasElectronics: false,
      hasFood: false,
      hasCosme: true,
    })
    expect(result.compliant).toBe(true)
    expect(result.requiredCertifications).toContain('BPOM')
  })

  it('checkCompliance warnings include food note when hasFood=true', () => {
    const result = checkCompliance({
      category: 'kitchenware',
      market: 'SG',
      hasElectronics: false,
      hasFood: true,
      hasCosme: false,
    })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('Food-related')
    expect(result.warnings[0]).toContain('SG')
  })

  it('getRequiredCertifications with subcategory prefix match', () => {
    // 'electronics-appliances' should match rule key 'electronics' via prefix
    const certs = getRequiredCertifications('electronics-appliances', 'SG')
    expect(certs).toContain('IMDA')
  })

  it('checkCompliance certifications are deduplicated', () => {
    // category=electronics (→ IMDA) + hasElectronics=true (→ IMDA again): should appear once
    const result = checkCompliance({
      category: 'electronics',
      market: 'SG',
      hasElectronics: true,
      hasFood: false,
      hasCosme: false,
    })
    const imdaCount = result.requiredCertifications.filter((c) => c === 'IMDA').length
    expect(imdaCount).toBe(1)
  })
})
