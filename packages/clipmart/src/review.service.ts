import type { TemplateReview } from './clipmart.types.js'
import { ClipmartError } from './clipmart.types.js'
import type { TemplateStore } from './template.service.js'

export interface ReviewStore {
  create(review: Omit<TemplateReview, 'createdAt' | 'deletedAt'> & { id: string }): Promise<void>
  getByTemplate(templateId: string, limit: number, offset: number): Promise<TemplateReview[]>
  calcAvgRating(templateId: string): Promise<number | null>
  findByTemplateAndTenant(templateId: string, tenantId: string): Promise<TemplateReview | null>
}

export interface ReviewServiceDeps {
  reviewStore: ReviewStore
  templateStore: TemplateStore
  generateId: () => string
}

export interface CreateReviewInput {
  templateId: string
  tenantId: string
  rating: number
  comment?: string
  gmvChange?: number
}

export function createReviewService(deps: ReviewServiceDeps) {
  const { reviewStore, templateStore, generateId } = deps

  async function createReview(input: CreateReviewInput): Promise<TemplateReview> {
    if (input.rating < 1 || input.rating > 5 || !Number.isInteger(input.rating)) {
      throw new ClipmartError('Rating must be an integer between 1 and 5', 'INVALID_RATING')
    }

    const template = await templateStore.getById(input.templateId)
    if (!template) throw new ClipmartError(`Template not found: ${input.templateId}`, 'TEMPLATE_NOT_FOUND')

    const existingReview = await reviewStore.findByTemplateAndTenant(
      input.templateId,
      input.tenantId,
    )
    if (existingReview) {
      throw new ClipmartError('Each tenant may only review a template once', 'DUPLICATE_REVIEW')
    }

    const id = generateId()
    await reviewStore.create({
      id,
      templateId: input.templateId,
      tenantId: input.tenantId,
      rating: input.rating,
      comment: input.comment ?? null,
      gmvChange: input.gmvChange ?? null,
    })

    const avgRating = await reviewStore.calcAvgRating(input.templateId)
    if (avgRating !== null) {
      await templateStore.updateRating(input.templateId, avgRating)
    }

    return {
      id,
      templateId: input.templateId,
      tenantId: input.tenantId,
      rating: input.rating,
      comment: input.comment ?? null,
      gmvChange: input.gmvChange ?? null,
      createdAt: new Date(),
      deletedAt: null,
    }
  }

  async function getReviews(
    templateId: string,
    limit = 20,
    offset = 0,
  ): Promise<TemplateReview[]> {
    return reviewStore.getByTemplate(templateId, limit, offset)
  }

  return { createReview, getReviews }
}

export type ReviewService = ReturnType<typeof createReviewService>

export function createInMemoryReviewStore(): ReviewStore {
  const reviews: TemplateReview[] = []

  return {
    async create(input) {
      reviews.push({
        ...input,
        createdAt: new Date(),
        deletedAt: null,
      })
    },

    async getByTemplate(templateId, limit, offset) {
      return reviews
        .filter((r) => r.templateId === templateId && !r.deletedAt)
        .slice(offset, offset + limit)
    },

    async calcAvgRating(templateId) {
      const tplReviews = reviews.filter(
        (r) => r.templateId === templateId && !r.deletedAt,
      )
      if (tplReviews.length === 0) return null
      const sum = tplReviews.reduce((acc, r) => acc + r.rating, 0)
      return Math.round((sum / tplReviews.length) * 100) / 100
    },

    async findByTemplateAndTenant(templateId, tenantId) {
      return reviews.find(
        (r) =>
          r.templateId === templateId &&
          r.tenantId === tenantId &&
          !r.deletedAt,
      ) ?? null
    },
  }
}
