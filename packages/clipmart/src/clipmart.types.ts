export interface ClipmartTemplate {
  id: string
  authorTenantId: string | null
  name: string
  description: string | null
  category: string
  targetMarkets: string[]
  targetCategories: string[]
  platforms: string[]
  config: Record<string, unknown>
  performance: Record<string, unknown>
  downloads: number
  rating: number | null
  isOfficial: boolean
  isPublic: boolean
  createdAt: Date
  deletedAt: Date | null
}

export interface TemplateReview {
  id: string
  templateId: string
  tenantId: string
  rating: number
  comment: string | null
  gmvChange: number | null
  createdAt: Date
  deletedAt: Date | null
}

export interface TemplateSearchFilters {
  category?: string
  targetMarkets?: string[]
  platforms?: string[]
  query?: string
  isOfficial?: boolean
  limit?: number
  offset?: number
}

export interface CreateTemplateInput {
  authorTenantId: string
  name: string
  description?: string
  category: string
  targetMarkets?: string[]
  targetCategories?: string[]
  platforms?: string[]
  config: Record<string, unknown>
  isOfficial?: boolean
}

export type OfficialTemplateSeed = Omit<CreateTemplateInput, 'authorTenantId'>

export type ClipmartErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'SECURITY_VIOLATION'
  | 'DUPLICATE_REVIEW'
  | 'INVALID_RATING'
  | 'PERSIST_FAILED'

export class ClipmartError extends Error {
  constructor(
    message: string,
    public readonly code: ClipmartErrorCode,
  ) {
    super(message)
    this.name = 'ClipmartError'
  }
}
