import { describe, expect, it } from 'vitest'
import {
  canUseAgent,
  canAddPlatform,
  canUseDataOS,
  getMonthlyBudget,
  getDataOSTier,
} from './plan-enforcer.js'
import type { PlanName } from './billing.types.js'

const ALL_PLANS: PlanName[] = ['starter', 'growth', 'scale']

describe('plan-enforcer', () => {
  describe('canUseAgent', () => {
    it('allows starter agents on starter plan', () => {
      expect(canUseAgent('starter', 'product-scout')).toEqual({ allowed: true })
      expect(canUseAgent('starter', 'price-sentinel')).toEqual({ allowed: true })
      expect(canUseAgent('starter', 'support-relay')).toEqual({ allowed: true })
    })

    it('rejects growth-only agents on starter plan', () => {
      const result = canUseAgent('starter', 'ads-optimizer')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('starter')
    })

    it('allows all 7 agents on growth plan', () => {
      const growthAgents = [
        'product-scout', 'price-sentinel', 'support-relay',
        'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel',
      ]
      for (const agent of growthAgents) {
        expect(canUseAgent('growth', agent)).toEqual({ allowed: true })
      }
    })

    it('rejects scale-only agents on growth plan', () => {
      const result = canUseAgent('growth', 'finance-agent')
      expect(result.allowed).toBe(false)
    })

    it('allows all 9 agents on scale plan', () => {
      const scaleAgents = [
        'product-scout', 'price-sentinel', 'support-relay',
        'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel',
        'finance-agent', 'ceo-agent',
      ]
      for (const agent of scaleAgents) {
        expect(canUseAgent('scale', agent)).toEqual({ allowed: true })
      }
    })
  })

  describe('canAddPlatform', () => {
    it('allows first platform on starter plan', () => {
      expect(canAddPlatform('starter', 0)).toEqual({ allowed: true })
    })

    it('rejects second platform on starter plan', () => {
      const result = canAddPlatform('starter', 1)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('1')
    })

    it('allows up to 3 platforms on growth plan', () => {
      expect(canAddPlatform('growth', 0).allowed).toBe(true)
      expect(canAddPlatform('growth', 2).allowed).toBe(true)
      expect(canAddPlatform('growth', 3).allowed).toBe(false)
    })

    it('allows up to 5 platforms on scale plan', () => {
      expect(canAddPlatform('scale', 4).allowed).toBe(true)
      expect(canAddPlatform('scale', 5).allowed).toBe(false)
    })
  })

  describe('canUseDataOS', () => {
    it('rejects DataOS on starter plan', () => {
      const result = canUseDataOS('starter')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('starter')
    })

    it('allows DataOS on growth plan', () => {
      expect(canUseDataOS('growth')).toEqual({ allowed: true })
    })

    it('allows DataOS on scale plan', () => {
      expect(canUseDataOS('scale')).toEqual({ allowed: true })
    })
  })

  describe('getMonthlyBudget', () => {
    it('returns correct budget for each plan', () => {
      expect(getMonthlyBudget('starter')).toBe(160)
      expect(getMonthlyBudget('growth')).toBe(500)
      expect(getMonthlyBudget('scale')).toBe(1200)
    })

    it('returns ascending budgets', () => {
      const budgets = ALL_PLANS.map(getMonthlyBudget)
      for (let i = 1; i < budgets.length; i++) {
        expect(budgets[i]).toBeGreaterThan(budgets[i - 1])
      }
    })
  })

  describe('getDataOSTier', () => {
    it('returns correct tier for each plan', () => {
      expect(getDataOSTier('starter')).toBe('none')
      expect(getDataOSTier('growth')).toBe('partial')
      expect(getDataOSTier('scale')).toBe('full')
    })
  })
})
