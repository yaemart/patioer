import { describe, it, expect } from 'vitest'
import { resolveSop } from './sop-resolver.js'
import type { SopRecord, SopResolutionContext } from './types.js'

const TENANT = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-04-10T12:00:00Z')

function makeSop(overrides: Partial<SopRecord> = {}): SopRecord {
  return {
    id: crypto.randomUUID(),
    tenantId: TENANT,
    scope: 'price-sentinel',
    platform: null,
    entityType: null,
    entityId: null,
    scenarioId: null,
    scenario: null,
    sopText: 'default sop text',
    extractedGoalContext: null,
    extractedSystemPrompt: null,
    extractedGovernance: null,
    extractionWarnings: null,
    status: 'active',
    effectiveFrom: null,
    effectiveTo: null,
    previousVersionId: null,
    version: 1,
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
    ...overrides,
  }
}

function makeCtx(overrides: Partial<SopResolutionContext> = {}): SopResolutionContext {
  return {
    agentScope: 'price-sentinel',
    tenantId: TENANT,
    now: NOW,
    ...overrides,
  }
}

describe('resolveSop', () => {
  it('returns null when no SOPs exist', () => {
    expect(resolveSop([], makeCtx())).toBeNull()
  })

  it('returns null when no matching scope', () => {
    const sop = makeSop({ scope: 'ads-optimizer' })
    expect(resolveSop([sop], makeCtx())).toBeNull()
  })

  it('skips archived and draft SOPs', () => {
    const archived = makeSop({ status: 'archived' })
    const draft = makeSop({ status: 'draft' })
    expect(resolveSop([archived, draft], makeCtx())).toBeNull()
  })

  describe('Rule 1: entity > platform > global (narrower scope wins)', () => {
    it('entity-scoped SOP wins over platform-scoped', () => {
      const global = makeSop({ sopText: 'global' })
      const platform = makeSop({
        platform: 'amazon',
        sopText: 'platform',
      })
      const entity = makeSop({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-001',
        sopText: 'entity',
      })

      const ctx = makeCtx({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-001',
      })

      const result = resolveSop([global, platform, entity], ctx)
      expect(result).not.toBeNull()
      expect(result!.sop.sopText).toBe('entity')
    })

    it('platform-scoped SOP wins over global', () => {
      const global = makeSop({ sopText: 'global' })
      const platform = makeSop({
        platform: 'amazon',
        sopText: 'platform',
      })

      const ctx = makeCtx({ platform: 'amazon' })
      const result = resolveSop([global, platform], ctx)
      expect(result).not.toBeNull()
      expect(result!.sop.sopText).toBe('platform')
    })

    it('entity SOP for wrong entity does not match', () => {
      const entity = makeSop({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-999',
        sopText: 'entity',
      })
      const global = makeSop({ sopText: 'global' })

      const ctx = makeCtx({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-001',
      })

      const result = resolveSop([entity, global], ctx)
      expect(result!.sop.sopText).toBe('global')
    })
  })

  describe('Rule 2: time-windowed > no time window', () => {
    it('time-windowed SOP wins over unbounded at same scope', () => {
      const unbounded = makeSop({ sopText: 'always' })
      const windowed = makeSop({
        sopText: 'limited-time',
        effectiveFrom: new Date('2026-04-01'),
        effectiveTo: new Date('2026-04-30'),
      })

      const result = resolveSop([unbounded, windowed], makeCtx())
      expect(result!.sop.sopText).toBe('limited-time')
    })
  })

  describe('Rule 3: same layer + same time window → highest version', () => {
    it('higher version wins', () => {
      const v1 = makeSop({ version: 1, sopText: 'v1' })
      const v2 = makeSop({ version: 2, sopText: 'v2' })

      const result = resolveSop([v1, v2], makeCtx())
      expect(result!.sop.sopText).toBe('v2')
    })
  })

  describe('Rule 4: narrow goalContext fully overrides wider (no merge)', () => {
    it('resolved SOP carries its own goalContext without merging', () => {
      const global = makeSop({
        sopText: 'global',
        extractedGoalContext: { minMargin: 15, strategy: 'balanced' },
      })
      const platform = makeSop({
        platform: 'amazon',
        sopText: 'amazon-specific',
        extractedGoalContext: { minMargin: 5 },
      })

      const ctx = makeCtx({ platform: 'amazon' })
      const result = resolveSop([global, platform], ctx)
      expect(result!.sop.extractedGoalContext).toEqual({ minMargin: 5 })
    })
  })

  describe('Rule 5: expired SOPs are skipped → fallback', () => {
    it('expired SOP is skipped even if it would otherwise win', () => {
      const expired = makeSop({
        platform: 'amazon',
        sopText: 'expired-platform',
        effectiveFrom: new Date('2026-03-01'),
        effectiveTo: new Date('2026-04-05'),
      })
      const global = makeSop({ sopText: 'global-fallback' })

      const ctx = makeCtx({ platform: 'amazon' })
      const result = resolveSop([expired, global], ctx)
      expect(result!.sop.sopText).toBe('global-fallback')
    })

    it('not-yet-effective SOP is skipped', () => {
      const future = makeSop({
        sopText: 'future',
        effectiveFrom: new Date('2026-05-01'),
      })
      const global = makeSop({ sopText: 'global' })

      const result = resolveSop([future, global], makeCtx())
      expect(result!.sop.sopText).toBe('global')
    })
  })

  describe('resolution path', () => {
    it('builds correct path for entity-scoped SOP', () => {
      const entity = makeSop({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-001',
        version: 3,
      })

      const ctx = makeCtx({
        platform: 'amazon',
        entityType: 'product',
        entityId: 'ASIN-001',
      })

      const result = resolveSop([entity], ctx)
      expect(result!.resolutionPath).toBe('price-sentinel/amazon/product/ASIN-001/v3')
    })

    it('builds correct path for global SOP', () => {
      const global = makeSop({ version: 2 })
      const result = resolveSop([global], makeCtx())
      expect(result!.resolutionPath).toBe('price-sentinel/v2')
    })
  })
})
