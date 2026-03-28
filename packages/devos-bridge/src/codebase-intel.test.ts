import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { buildCodebaseIndex, queryCodebase } from './codebase-intel.js'

const ROOT = resolve(import.meta.dirname, '../../..')

describe('Codebase Intel (D-12)', () => {
  const index = buildCodebaseIndex(ROOT)

  it('index contains agent files', () => {
    const agents = index.entries.filter((e) => e.kind === 'agent')
    expect(agents.length).toBeGreaterThanOrEqual(7)
  })

  it('index contains harness files', () => {
    const harness = index.entries.filter((e) => e.kind === 'harness')
    expect(harness.length).toBeGreaterThanOrEqual(1)
  })

  it('index contains route files', () => {
    const routes = index.entries.filter((e) => e.kind === 'route')
    expect(routes.length).toBeGreaterThanOrEqual(1)
  })

  describe('AC-P4-12: 正确回答代码定位问题', () => {
    it('"Price Sentinel 在哪个文件？" → price-sentinel.agent.ts', () => {
      const result = queryCodebase(index, 'Price Sentinel 在哪个文件？')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('price-sentinel.agent.ts')
    })

    it('"Product Scout 在哪个文件？" → product-scout.agent.ts', () => {
      const result = queryCodebase(index, 'Product Scout 在哪个文件？')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('product-scout.agent.ts')
    })

    it('"Ads Optimizer 在哪里？" → ads-optimizer.agent.ts', () => {
      const result = queryCodebase(index, 'Ads Optimizer 在哪里？')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('ads-optimizer.agent.ts')
    })

    it('"Inventory Guard 定义在？" → inventory-guard.agent.ts', () => {
      const result = queryCodebase(index, 'Inventory Guard 定义在？')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('inventory-guard.agent.ts')
    })

    it('"Support Relay" → support-relay.agent.ts', () => {
      const result = queryCodebase(index, 'Support Relay')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('support-relay.agent.ts')
    })

    it('"Content Writer" → content-writer.agent.ts', () => {
      const result = queryCodebase(index, 'Content Writer')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('content-writer.agent.ts')
    })

    it('"Market Intel" → market-intel.agent.ts', () => {
      const result = queryCodebase(index, 'Market Intel')
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches[0]!.entry.name).toBe('market-intel.agent.ts')
    })

    it('"decision-memory" → decision-memory.ts', () => {
      const result = queryCodebase(index, 'decision memory')
      expect(result.matches.length).toBeGreaterThan(0)
      const topNames = result.matches.map((m) => m.entry.name)
      expect(topNames).toContain('decision-memory.ts')
    })

    it('"feature store" → feature-store.ts', () => {
      const result = queryCodebase(index, 'feature store')
      expect(result.matches.length).toBeGreaterThan(0)
      const topNames = result.matches.map((m) => m.entry.name)
      expect(topNames).toContain('feature-store.ts')
    })

    it('"soft delete migration" → 002_soft_delete.sql', () => {
      const result = queryCodebase(index, 'soft delete')
      expect(result.matches.length).toBeGreaterThan(0)
      const topNames = result.matches.map((m) => m.entry.name)
      expect(topNames).toContain('002_soft_delete.sql')
    })
  })
})
