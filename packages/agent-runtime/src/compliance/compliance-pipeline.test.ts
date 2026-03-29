import { describe, it, expect, vi } from 'vitest'
import {
  checkProhibitedKeywords,
  checkCategoryRestrictions,
  checkCertificationRequirements,
  checkHSCode,
  aiContentReview,
  runComplianceCheck,
  runMultiMarketCompliance,
} from './compliance-pipeline.js'
import type { ComplianceProductInput } from './prohibited-keywords.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function product(overrides?: Partial<ComplianceProductInput>): ComplianceProductInput {
  return {
    productId: 'test-001',
    title: 'Generic Widget',
    description: 'A simple widget for everyday use',
    category: 'general',
    price: 25,
    ...overrides,
  }
}

function mockCtx() {
  return {
    tenantId: 'tenant-test',
    agentId: 'compliance-test',
    logAction: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    llm: vi.fn().mockResolvedValue({ text: '{ "issues": [] }' }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    getHarness: vi.fn(),
    getEnabledPlatforms: vi.fn().mockReturnValue([]),
    describeDataOsCapabilities: vi.fn().mockReturnValue(''),
  } as unknown as import('../context.js').AgentContext
}

// ─── 1. checkProhibitedKeywords ───────────────────────────────────────────────

describe('checkProhibitedKeywords', () => {
  it('detects chewing gum in SG market (title)', () => {
    const v = checkProhibitedKeywords(
      product({ title: 'Premium Chewing Gum Mint Flavor' }),
      'SG',
    )
    expect(v.length).toBeGreaterThanOrEqual(1)
    expect(v[0].checkType).toBe('prohibited_keyword')
    expect(v[0].severity).toBe('block')
    expect(v[0].matchedValue).toBe('chewing gum')
  })

  it('detects pork in ID market with warn severity', () => {
    const v = checkProhibitedKeywords(
      product({ description: 'Contains real pork sausage flavor' }),
      'ID',
    )
    const porkV = v.find((x) => x.matchedValue === 'pork')
    expect(porkV).toBeDefined()
    expect(porkV!.severity).toBe('warn')
  })

  it('detects nazi content in DE market', () => {
    const v = checkProhibitedKeywords(
      product({ title: 'Historical Nazi memorabilia collection' }),
      'DE',
    )
    expect(v.some((x) => x.severity === 'block')).toBe(true)
  })

  it('detects kinder surprise in US market', () => {
    const v = checkProhibitedKeywords(
      product({ title: 'Kinder Surprise Egg' }),
      'US',
    )
    expect(v.some((x) => x.matchedValue === 'kinder surprise')).toBe(true)
    expect(v[0].severity).toBe('block')
  })

  it('returns empty for clean product', () => {
    const v = checkProhibitedKeywords(product(), 'SG')
    expect(v).toHaveLength(0)
  })

  it('checks tags field', () => {
    const v = checkProhibitedKeywords(
      product({ tags: ['vape', 'nicotine'] }),
      'SG',
    )
    expect(v.some((x) => x.matchedValue === 'vape')).toBe(true)
  })
})

// ─── 2. checkCategoryRestrictions ─────────────────────────────────────────────

describe('checkCategoryRestrictions', () => {
  it('flags electronics in SG (IMDA required)', () => {
    const v = checkCategoryRestrictions(product({ category: 'electronics' }), 'SG')
    expect(v).toHaveLength(1)
    expect(v[0].suggestion).toContain('IMDA')
  })

  it('flags food in ID (BPOM + Halal)', () => {
    const v = checkCategoryRestrictions(product({ category: 'food' }), 'ID')
    expect(v.length).toBeGreaterThanOrEqual(2)
    expect(v.some((x) => x.suggestion?.includes('BPOM'))).toBe(true)
    expect(v.some((x) => x.suggestion?.includes('Halal'))).toBe(true)
  })

  it('flags electronics in DE (WEEE)', () => {
    const v = checkCategoryRestrictions(product({ category: 'electronics' }), 'DE')
    expect(v.some((x) => x.suggestion?.includes('WEEE'))).toBe(true)
  })

  it('flags toys in US (CPSC)', () => {
    const v = checkCategoryRestrictions(product({ category: 'toys' }), 'US')
    expect(v.some((x) => x.suggestion?.includes('CPSC'))).toBe(true)
  })

  it('returns empty when no category set', () => {
    const v = checkCategoryRestrictions(product({ category: undefined }), 'SG')
    expect(v).toHaveLength(0)
  })
})

// ─── 3. checkCertificationRequirements (AC-P4-17: Halal) ──────────────────────

describe('checkCertificationRequirements', () => {
  it('AC-P4-17: detects missing Halal cert for food in ID', () => {
    const v = checkCertificationRequirements(
      product({ category: 'food', certifications: ['BPOM'] }),
      'ID',
    )
    const halalV = v.find((x) => x.matchedValue === 'Halal')
    expect(halalV).toBeDefined()
    expect(halalV!.severity).toBe('block')
    expect(halalV!.checkType).toBe('certification_missing')
  })

  it('passes when all required certs present', () => {
    const v = checkCertificationRequirements(
      product({ category: 'food', certifications: ['BPOM', 'Halal'] }),
      'ID',
    )
    expect(v).toHaveLength(0)
  })

  it('detects missing IMDA for electronics in SG', () => {
    const v = checkCertificationRequirements(
      product({ category: 'electronics', certifications: [] }),
      'SG',
    )
    expect(v.some((x) => x.matchedValue === 'IMDA')).toBe(true)
  })

  it('cert check is case-insensitive', () => {
    const v = checkCertificationRequirements(
      product({ category: 'food', certifications: ['bpom', 'halal'] }),
      'ID',
    )
    expect(v).toHaveLength(0)
  })

  it('returns empty when no category set', () => {
    const v = checkCertificationRequirements(product({ category: undefined }), 'ID')
    expect(v).toHaveLength(0)
  })
})

// ─── 4. checkHSCode ───────────────────────────────────────────────────────────

describe('checkHSCode', () => {
  it('blocks ammunition HS code 9306', () => {
    const v = checkHSCode(product({ hsCode: '930600' }), 'US')
    expect(v.some((x) => x.severity === 'block')).toBe(true)
  })

  it('warns on electronics HS code 8517 missing FCC', () => {
    const v = checkHSCode(
      product({ hsCode: '851762', certifications: [] }),
      'US',
    )
    expect(v.some((x) => x.rule.includes('FCC'))).toBe(true)
  })

  it('no warning if certs present for HS code', () => {
    const v = checkHSCode(
      product({ hsCode: '851762', certifications: ['FCC', 'IMDA'] }),
      'US',
    )
    expect(v).toHaveLength(0)
  })

  it('returns empty when no HS code', () => {
    const v = checkHSCode(product(), 'US')
    expect(v).toHaveLength(0)
  })
})

// ─── 5. aiContentReview ───────────────────────────────────────────────────────

describe('aiContentReview', () => {
  it('parses LLM response with issues', async () => {
    const llm = vi.fn().mockResolvedValue({
      text: '{ "issues": [{ "field": "title", "issue": "Contains misleading health claim", "severity": "warn" }] }',
    })
    const v = await aiContentReview(product(), 'US', llm)
    expect(v).toHaveLength(1)
    expect(v[0].checkType).toBe('ai_content')
    expect(v[0].severity).toBe('warn')
  })

  it('returns empty for clean LLM response', async () => {
    const llm = vi.fn().mockResolvedValue({ text: '{ "issues": [] }' })
    const v = await aiContentReview(product(), 'SG', llm)
    expect(v).toHaveLength(0)
  })

  it('returns empty for unparseable LLM response', async () => {
    const llm = vi.fn().mockResolvedValue({ text: 'I cannot help with that request' })
    const v = await aiContentReview(product(), 'SG', llm)
    expect(v).toHaveLength(0)
  })

  it('filters out invalid severity values', async () => {
    const llm = vi.fn().mockResolvedValue({
      text: '{ "issues": [{ "field": "title", "issue": "test", "severity": "critical" }] }',
    })
    const v = await aiContentReview(product(), 'SG', llm)
    expect(v).toHaveLength(0)
  })
})

// ─── 6. runComplianceCheck (orchestrator) ─────────────────────────────────────

describe('runComplianceCheck', () => {
  it('returns passed=true for clean product', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(product(), 'SG', ctx)
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(ctx.createTicket).not.toHaveBeenCalled()
  })

  it('returns passed=false and creates ticket for prohibited product', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({ title: 'Chewing Gum Pack' }),
      'SG',
      ctx,
    )
    expect(result.passed).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('[Compliance]'),
      }),
    )
  })

  it('AC-P4-18: creates ticket with violation details', async () => {
    const ctx = mockCtx()
    await runComplianceCheck(
      product({ title: 'E-Cigarette Starter Kit', description: 'Premium vape device' }),
      'SG',
      ctx,
    )
    expect(ctx.createTicket).toHaveBeenCalledTimes(1)
    const ticketArg = vi.mocked(ctx.createTicket).mock.calls[0][0]
    expect(ticketArg.body).toContain('BLOCK')
  })

  it('includes AI review when enabled', async () => {
    const ctx = mockCtx()
    vi.mocked(ctx.llm).mockResolvedValue({
      text: '{ "issues": [{ "field": "description", "issue": "Potential trademark issue", "severity": "warn" }] }',
    })
    const result = await runComplianceCheck(product(), 'US', ctx, { enableAiReview: true })
    expect(result.violations.some((v) => v.checkType === 'ai_content')).toBe(true)
  })

  it('degrades gracefully when AI review fails', async () => {
    const ctx = mockCtx()
    vi.mocked(ctx.llm).mockRejectedValue(new Error('LLM down'))
    const result = await runComplianceCheck(product(), 'US', ctx, { enableAiReview: true })
    expect(result.passed).toBe(true)
    expect(ctx.logAction).toHaveBeenCalledWith('compliance.ai_review_degraded', expect.any(Object))
  })
})

// ─── 7. runMultiMarketCompliance ──────────────────────────────────────────────

describe('runMultiMarketCompliance', () => {
  it('checks all specified markets', async () => {
    const ctx = mockCtx()
    const results = await runMultiMarketCompliance(product(), ['SG', 'ID', 'US'], ctx)
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.market)).toEqual(['SG', 'ID', 'US'])
  })

  it('logs multi-market completion', async () => {
    const ctx = mockCtx()
    await runMultiMarketCompliance(product(), ['SG', 'DE'], ctx)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'compliance.multi_market_completed',
      expect.objectContaining({ markets: ['SG', 'DE'] }),
    )
  })
})

// ─── 8. E2E Scenario: ID market Halal + Prohibited (AC-P4-17 + AC-P4-18) ─────

describe('E2E: Indonesia market compliance', () => {
  it('AC-P4-17: food without Halal cert is blocked', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({
        productId: 'food-id-001',
        title: 'Premium Dried Beef Snack',
        description: 'Traditional beef jerky, high protein',
        category: 'food',
        certifications: ['BPOM'],
      }),
      'ID',
      ctx,
    )
    expect(result.passed).toBe(false)
    const halalV = result.violations.find((v) => v.matchedValue === 'Halal')
    expect(halalV).toBeDefined()
    expect(halalV!.checkType).toBe('certification_missing')
    expect(ctx.createTicket).toHaveBeenCalled()
  })

  it('AC-P4-17: food with Halal + BPOM cert passes', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({
        productId: 'food-id-002',
        title: 'Premium Dried Beef Snack',
        description: 'Traditional beef jerky, halal certified',
        category: 'food',
        certifications: ['BPOM', 'Halal'],
      }),
      'ID',
      ctx,
    )
    expect(result.passed).toBe(true)
  })

  it('AC-P4-18: pork product triggers warn + alcohol triggers warn', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({
        productId: 'risky-id-001',
        title: 'Imported Pork Sausages with Beer',
        description: 'Premium pork sausages paired with craft beer',
        category: 'food',
      }),
      'ID',
      ctx,
    )
    const porkWarns = result.violations.filter((v) =>
      v.matchedValue === 'pork' || v.matchedValue === 'beer',
    )
    expect(porkWarns.length).toBeGreaterThanOrEqual(2)
    expect(ctx.createTicket).toHaveBeenCalled()
  })

  it('AC-P4-18: gambling product blocked', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({
        productId: 'gamble-id-001',
        title: 'Online Gambling Chip Set',
        description: 'Professional gambling casino chip kit',
      }),
      'ID',
      ctx,
    )
    expect(result.passed).toBe(false)
    expect(result.violations.some((v) => v.severity === 'block')).toBe(true)
  })
})

describe('E2E: Singapore market prohibited items', () => {
  it('AC-P4-18: e-cigarette blocked', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({
        title: 'JUUL E-Cigarette Pod System',
        description: 'Electronic cigarette vaping device',
      }),
      'SG',
      ctx,
    )
    expect(result.passed).toBe(false)
    expect(ctx.createTicket).toHaveBeenCalledTimes(1)
  })

  it('AC-P4-18: fireworks blocked', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({ title: 'Celebration Firework Pack' }),
      'SG',
      ctx,
    )
    expect(result.passed).toBe(false)
  })
})

describe('E2E: Germany market compliance', () => {
  it('AC-P4-18: counterfeit goods blocked', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({ title: 'Replica Brand Luxury Handbag' }),
      'DE',
      ctx,
    )
    expect(result.passed).toBe(false)
  })

  it('electronics require WEEE cert', async () => {
    const ctx = mockCtx()
    const result = await runComplianceCheck(
      product({ category: 'electronics', certifications: [] }),
      'DE',
      ctx,
    )
    const weee = result.violations.find((v) => v.matchedValue === 'WEEE')
    expect(weee).toBeDefined()
  })
})
