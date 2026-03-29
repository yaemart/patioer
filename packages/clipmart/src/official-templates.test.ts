import { describe, expect, it } from 'vitest'
import { OFFICIAL_TEMPLATES } from './official-templates.js'
import { validateTemplateConfig } from './security-validator.js'

describe('official-templates', () => {
  it('has exactly 5 official templates', () => {
    expect(OFFICIAL_TEMPLATES).toHaveLength(5)
  })

  it.each(OFFICIAL_TEMPLATES.map((t) => [t.name, t]))('%s passes security validation', (_name, template) => {
    const result = validateTemplateConfig(template.config)
    expect(result.valid).toBe(true)
  })

  it.each(OFFICIAL_TEMPLATES.map((t) => [t.name, t]))('%s is marked as official', (_name, template) => {
    expect(template.isOfficial).toBe(true)
  })

  it.each(OFFICIAL_TEMPLATES.map((t) => [t.name, t]))('%s has at least one agent', (_name, template) => {
    const agents = (template.config as Record<string, unknown>).agents as unknown[]
    expect(agents.length).toBeGreaterThanOrEqual(1)
  })

  it.each(OFFICIAL_TEMPLATES.map((t) => [t.name, t]))('%s has governance settings', (_name, template) => {
    expect(template.config).toHaveProperty('governance')
  })

  it.each(OFFICIAL_TEMPLATES.map((t) => [t.name, t]))('%s does not hardcode author tenant id', (_name, template) => {
    expect(template).not.toHaveProperty('authorTenantId')
  })

  it('Standard Cross-Border has all 9 agents', () => {
    const standard = OFFICIAL_TEMPLATES.find((t) => t.name === 'Standard Cross-Border')!
    const agents = (standard.config as Record<string, unknown>).agents as { type: string }[]
    expect(agents).toHaveLength(9)
    const types = agents.map((a) => a.type).sort()
    expect(types).toEqual([
      'ads-optimizer', 'ceo-agent', 'content-writer', 'finance-agent',
      'inventory-guard', 'market-intel', 'price-sentinel', 'product-scout', 'support-relay',
    ])
  })

  it('SEA Marketplace targets Southeast Asian markets', () => {
    const sea = OFFICIAL_TEMPLATES.find((t) => t.name === 'SEA Marketplace')!
    expect(sea.targetMarkets).toContain('SG')
    expect(sea.targetMarkets).toContain('ID')
    expect(sea.platforms).toContain('tiktok')
    expect(sea.platforms).toContain('shopee')
  })

  it('Amazon PPC Pro has targetRoas in ads-optimizer config', () => {
    const ppc = OFFICIAL_TEMPLATES.find((t) => t.name === 'Amazon PPC Pro')!
    const agents = (ppc.config as Record<string, unknown>).agents as { type: string; goalContext: Record<string, unknown> }[]
    const adsAgent = agents.find((a) => a.type === 'ads-optimizer')!
    expect(adsAgent.goalContext.targetRoas).toBe(4.0)
  })

  it('B2B Wholesale has all 9 agents for Scale plan', () => {
    const b2b = OFFICIAL_TEMPLATES.find((t) => t.name === 'B2B Wholesale')!
    const agents = (b2b.config as Record<string, unknown>).agents as { type: string }[]
    expect(agents).toHaveLength(9)
    expect(b2b.platforms).toEqual(['b2b-portal', 'amazon-business'])
  })

  it('search for 定价 matches SEA Marketplace description', () => {
    const matched = OFFICIAL_TEMPLATES.filter((t) =>
      t.name.includes('定价') ||
      (t.description && t.description.includes('定价')),
    )
    expect(matched.length).toBeGreaterThanOrEqual(1)
    expect(matched[0].name).toBe('SEA Marketplace')
  })
})
