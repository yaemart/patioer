import { describe, expect, it, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createReviewService, createInMemoryReviewStore } from './review.service.js'
import { createInMemoryTemplateStore } from './template.service.js'
import type { TemplateStore } from './template.service.js'
import type { ReviewStore } from './review.service.js'

const TEMPLATE_ID = 'tpl-review-001'

async function seedTemplate(store: TemplateStore) {
  await store.create({
    id: TEMPLATE_ID,
    authorTenantId: 'author-tenant',
    name: 'Test Template',
    category: 'full-stack',
    config: { agents: [] },
  })
}

function makeSvc(tStore?: TemplateStore, rStore?: ReviewStore) {
  const templateStore = tStore ?? createInMemoryTemplateStore()
  const reviewStore = rStore ?? createInMemoryReviewStore()
  return {
    svc: createReviewService({ reviewStore, templateStore, generateId: () => randomUUID() }),
    templateStore,
    reviewStore,
  }
}

describe('review.service', () => {
  let templateStore: TemplateStore
  let reviewStore: ReviewStore
  let svc: ReturnType<typeof makeSvc>['svc']

  beforeEach(async () => {
    templateStore = createInMemoryTemplateStore()
    reviewStore = createInMemoryReviewStore()
    const result = makeSvc(templateStore, reviewStore)
    svc = result.svc
    await seedTemplate(templateStore)
  })

  describe('createReview', () => {
    it('creates a review and returns it', async () => {
      const review = await svc.createReview({
        templateId: TEMPLATE_ID,
        tenantId: 'tenant-1',
        rating: 5,
        comment: 'Excellent template',
      })
      expect(review.id).toBeDefined()
      expect(review.rating).toBe(5)
      expect(review.comment).toBe('Excellent template')
    })

    it('updates template average rating after review', async () => {
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 5 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't2', rating: 3 })

      const tpl = await templateStore.getById(TEMPLATE_ID)
      expect(tpl!.rating).toBe(4)
    })

    it('stores gmvChange when provided', async () => {
      const review = await svc.createReview({
        templateId: TEMPLATE_ID,
        tenantId: 't1',
        rating: 4,
        gmvChange: 12.5,
      })
      expect(review.gmvChange).toBe(12.5)
    })

    it('rejects rating < 1', async () => {
      await expect(
        svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 0 }),
      ).rejects.toThrow('Rating must be an integer between 1 and 5')
    })

    it('rejects rating > 5', async () => {
      await expect(
        svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 6 }),
      ).rejects.toThrow('Rating must be an integer between 1 and 5')
    })

    it('rejects non-integer rating', async () => {
      await expect(
        svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 3.5 }),
      ).rejects.toThrow('Rating must be an integer between 1 and 5')
    })

    it('throws for non-existent template', async () => {
      await expect(
        svc.createReview({ templateId: 'no-such', tenantId: 't1', rating: 4 }),
      ).rejects.toThrow('Template not found')
    })

    it('rejects duplicate reviews from the same tenant', async () => {
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 5 })

      await expect(
        svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 4 }),
      ).rejects.toThrow('only review a template once')
    })
  })

  describe('getReviews', () => {
    it('returns reviews for a template', async () => {
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 5 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't2', rating: 4 })
      const reviews = await svc.getReviews(TEMPLATE_ID)
      expect(reviews).toHaveLength(2)
    })

    it('applies pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await svc.createReview({ templateId: TEMPLATE_ID, tenantId: `t${i}`, rating: 3 })
      }
      const page1 = await svc.getReviews(TEMPLATE_ID, 2, 0)
      const page2 = await svc.getReviews(TEMPLATE_ID, 2, 2)
      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
    })

    it('returns empty array for template with no reviews', async () => {
      const reviews = await svc.getReviews(TEMPLATE_ID)
      expect(reviews).toHaveLength(0)
    })
  })

  describe('average rating calculation', () => {
    it('calculates weighted average correctly', async () => {
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 5 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't2', rating: 4 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't3', rating: 3 })
      const tpl = await templateStore.getById(TEMPLATE_ID)
      expect(tpl!.rating).toBe(4)
    })

    it('rounds to 2 decimal places', async () => {
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't1', rating: 5 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't2', rating: 4 })
      await svc.createReview({ templateId: TEMPLATE_ID, tenantId: 't3', rating: 4 })
      const tpl = await templateStore.getById(TEMPLATE_ID)
      expect(tpl!.rating).toBe(4.33)
    })
  })
})
