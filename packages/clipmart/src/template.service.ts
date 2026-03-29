import type {
  ClipmartTemplate,
  TemplateSearchFilters,
  CreateTemplateInput,
} from './clipmart.types.js'
import { ClipmartError } from './clipmart.types.js'

export interface TemplateStore {
  create(input: CreateTemplateInput & { id: string }): Promise<void>
  getById(id: string): Promise<ClipmartTemplate | null>
  search(filters: TemplateSearchFilters): Promise<ClipmartTemplate[]>
  incrementDownloads(id: string): Promise<number>
  updateRating(id: string, avgRating: number): Promise<void>
  softDelete(id: string): Promise<boolean>
}

export interface TemplateServiceDeps {
  store: TemplateStore
  generateId: () => string
}

export function createTemplateService(deps: TemplateServiceDeps) {
  const { store, generateId } = deps

  async function createTemplate(input: CreateTemplateInput): Promise<ClipmartTemplate> {
    const id = generateId()
    await store.create({ ...input, id })
    const created = await store.getById(id)
    if (!created) throw new ClipmartError('Failed to persist template', 'PERSIST_FAILED')
    return created
  }

  async function getTemplate(id: string): Promise<ClipmartTemplate | null> {
    return store.getById(id)
  }

  async function searchTemplates(filters: TemplateSearchFilters): Promise<ClipmartTemplate[]> {
    return store.search(filters)
  }

  async function incrementDownloads(templateId: string): Promise<number> {
    return store.incrementDownloads(templateId)
  }

  async function updateRating(templateId: string, avgRating: number): Promise<void> {
    await store.updateRating(templateId, avgRating)
  }

  async function deleteTemplate(id: string): Promise<boolean> {
    return store.softDelete(id)
  }

  return {
    createTemplate,
    getTemplate,
    searchTemplates,
    incrementDownloads,
    updateRating,
    deleteTemplate,
  }
}

export type TemplateService = ReturnType<typeof createTemplateService>

export function applyTemplateFilters(
  templates: ClipmartTemplate[],
  filters: TemplateSearchFilters,
): ClipmartTemplate[] {
  let results = templates

  if (filters.category) {
    results = results.filter((t) => t.category === filters.category)
  }
  if (filters.targetMarkets && filters.targetMarkets.length > 0) {
    results = results.filter((t) =>
      filters.targetMarkets!.some((m) => t.targetMarkets.includes(m)),
    )
  }
  if (filters.platforms && filters.platforms.length > 0) {
    results = results.filter((t) =>
      filters.platforms!.some((p) => t.platforms.includes(p)),
    )
  }
  if (filters.isOfficial !== undefined) {
    results = results.filter((t) => t.isOfficial === filters.isOfficial)
  }
  if (filters.query) {
    const q = filters.query.toLowerCase()
    results = results.filter((t) =>
      t.name.toLowerCase().includes(q)
      || (t.description && t.description.toLowerCase().includes(q)),
    )
  }

  const offset = filters.offset ?? 0
  const limit = filters.limit ?? 50
  return results.slice(offset, offset + limit)
}

export function createInMemoryTemplateStore(): TemplateStore {
  const templates = new Map<string, ClipmartTemplate>()

  return {
    async create(input) {
      const template: ClipmartTemplate = {
        id: input.id,
        authorTenantId: input.authorTenantId,
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        targetMarkets: input.targetMarkets ?? [],
        targetCategories: input.targetCategories ?? [],
        platforms: input.platforms ?? [],
        config: input.config,
        performance: {},
        downloads: 0,
        rating: null,
        isOfficial: input.isOfficial ?? false,
        isPublic: true,
        createdAt: new Date(),
        deletedAt: null,
      }
      templates.set(input.id, template)
    },

    async getById(id) {
      const t = templates.get(id)
      if (!t || t.deletedAt) return null
      return t
    },

    async search(filters) {
      const live = Array.from(templates.values()).filter((t) => !t.deletedAt)
      return applyTemplateFilters(live, filters)
    },

    async incrementDownloads(id) {
      const t = templates.get(id)
      if (!t) return 0
      t.downloads += 1
      return t.downloads
    },

    async updateRating(id, avgRating) {
      const t = templates.get(id)
      if (t) t.rating = avgRating
    },

    async softDelete(id) {
      const t = templates.get(id)
      if (!t || t.deletedAt) return false
      t.deletedAt = new Date()
      return true
    },
  }
}

export function createSingleTemplateStore(
  template: ClipmartTemplate,
): TemplateStore {
  const current: ClipmartTemplate = {
    ...template,
    targetMarkets: [...template.targetMarkets],
    targetCategories: [...template.targetCategories],
    platforms: [...template.platforms],
    config: { ...template.config },
    performance: { ...template.performance },
  }
  return {
    async create() {
      throw new ClipmartError('Static template store is read-only', 'PERSIST_FAILED')
    },
    async getById(id) {
      if (id !== current.id || current.deletedAt) return null
      return current
    },
    async search(filters) {
      return applyTemplateFilters(current.deletedAt ? [] : [current], filters)
    },
    async incrementDownloads(id) {
      if (id !== current.id) return 0
      current.downloads += 1
      return current.downloads
    },
    async updateRating(id, avgRating) {
      if (id === current.id) current.rating = avgRating
    },
    async softDelete(id) {
      if (id !== current.id || current.deletedAt) return false
      current.deletedAt = new Date()
      return true
    },
  }
}
