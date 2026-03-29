import { describe, expect, it, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  createTemplateService,
  createInMemoryTemplateStore,
} from './template.service.js'
import type { CreateTemplateInput } from './clipmart.types.js'

function makeService() {
  return createTemplateService({
    store: createInMemoryTemplateStore(),
    generateId: () => randomUUID(),
  })
}

const BASE_INPUT: CreateTemplateInput = {
  authorTenantId: 'tenant-001',
  name: 'Standard Cross-Border',
  description: 'Full-stack cross-border ecommerce template',
  category: 'full-stack',
  targetMarkets: ['US', 'SG', 'DE'],
  platforms: ['shopify', 'amazon'],
  config: { agents: [{ type: 'product-scout' }] },
}

describe('template.service', () => {
  let svc: ReturnType<typeof makeService>

  beforeEach(() => {
    svc = makeService()
  })

  describe('createTemplate', () => {
    it('creates and returns a template', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      expect(t.id).toBeDefined()
      expect(t.name).toBe('Standard Cross-Border')
      expect(t.category).toBe('full-stack')
      expect(t.downloads).toBe(0)
      expect(t.rating).toBeNull()
      expect(t.isPublic).toBe(true)
      expect(t.deletedAt).toBeNull()
    })

    it('creates an official template', async () => {
      const t = await svc.createTemplate({ ...BASE_INPUT, isOfficial: true })
      expect(t.isOfficial).toBe(true)
    })
  })

  describe('getTemplate', () => {
    it('returns template by id', async () => {
      const created = await svc.createTemplate(BASE_INPUT)
      const found = await svc.getTemplate(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe(BASE_INPUT.name)
    })

    it('returns null for non-existent id', async () => {
      expect(await svc.getTemplate('non-existent')).toBeNull()
    })

    it('returns null for soft-deleted template', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      await svc.deleteTemplate(t.id)
      expect(await svc.getTemplate(t.id)).toBeNull()
    })
  })

  describe('searchTemplates', () => {
    async function seedTemplates() {
      await svc.createTemplate(BASE_INPUT)
      await svc.createTemplate({
        ...BASE_INPUT,
        name: 'SEA Marketplace',
        category: 'sea',
        targetMarkets: ['SG', 'ID', 'MY'],
        platforms: ['tiktok', 'shopee'],
      })
      await svc.createTemplate({
        ...BASE_INPUT,
        name: 'Amazon PPC Pro',
        description: 'Advanced Amazon advertising with定价 optimization',
        category: 'advertising',
        platforms: ['amazon'],
        isOfficial: true,
      })
    }

    it('returns all templates when no filters', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({})
      expect(results).toHaveLength(3)
    })

    it('filters by category', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ category: 'sea' })
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('SEA Marketplace')
    })

    it('filters by target markets', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ targetMarkets: ['ID'] })
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('SEA Marketplace')
    })

    it('filters by platforms', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ platforms: ['shopee'] })
      expect(results).toHaveLength(1)
    })

    it('filters by isOfficial', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ isOfficial: true })
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Amazon PPC Pro')
    })

    it('filters by query (name match)', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ query: 'SEA' })
      expect(results).toHaveLength(1)
    })

    it('filters by query (description match with 定价)', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({ query: '定价' })
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Amazon PPC Pro')
    })

    it('applies limit and offset', async () => {
      await seedTemplates()
      const page1 = await svc.searchTemplates({ limit: 2, offset: 0 })
      const page2 = await svc.searchTemplates({ limit: 2, offset: 2 })
      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it('excludes soft-deleted templates', async () => {
      await seedTemplates()
      const all = await svc.searchTemplates({})
      await svc.deleteTemplate(all[0].id)
      const afterDelete = await svc.searchTemplates({})
      expect(afterDelete).toHaveLength(2)
    })

    it('combines multiple filters', async () => {
      await seedTemplates()
      const results = await svc.searchTemplates({
        category: 'full-stack',
        platforms: ['shopify'],
      })
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Standard Cross-Border')
    })
  })

  describe('incrementDownloads', () => {
    it('increments and returns new count', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      expect(await svc.incrementDownloads(t.id)).toBe(1)
      expect(await svc.incrementDownloads(t.id)).toBe(2)
      expect(await svc.incrementDownloads(t.id)).toBe(3)
    })

    it('returns 0 for non-existent template', async () => {
      expect(await svc.incrementDownloads('no-such-id')).toBe(0)
    })
  })

  describe('updateRating', () => {
    it('updates template rating', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      await svc.updateRating(t.id, 4.5)
      const updated = await svc.getTemplate(t.id)
      expect(updated!.rating).toBe(4.5)
    })
  })

  describe('deleteTemplate', () => {
    it('soft deletes and returns true', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      expect(await svc.deleteTemplate(t.id)).toBe(true)
      expect(await svc.getTemplate(t.id)).toBeNull()
    })

    it('returns false for non-existent', async () => {
      expect(await svc.deleteTemplate('no-such-id')).toBe(false)
    })

    it('returns false for already deleted', async () => {
      const t = await svc.createTemplate(BASE_INPUT)
      await svc.deleteTemplate(t.id)
      expect(await svc.deleteTemplate(t.id)).toBe(false)
    })
  })
})
