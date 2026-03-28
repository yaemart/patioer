/** Same queue name as `@patioer/dataos` / DataOS API worker (BullMQ). */
export const DATAOS_LAKE_QUEUE_NAME = 'dataos-lake-ingest'


export interface DataOsLakeEventPayload {
  tenantId: string
  platform?: string
  agentId: string
  eventType: string
  entityId?: string
  payload: unknown
  metadata?: unknown
}

export interface DataOsClientOptions {
  baseUrl: string
  internalKey: string
  tenantId: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface DataOsCapabilityDescriptor {
  method: string
  path: string
  description: string
  parameters?: Record<string, string>
}

export interface DataOsCapabilities {
  version: string
  entities: Record<string, {
    operations: DataOsCapabilityDescriptor[]
  }>
}

export interface ProductFeaturesSnapshot {
  tenant_id: string
  platform: string
  product_id: string
  conv_rate_7d: string | null
  price_current: string | null
  [key: string]: unknown
}

export class DataOsClient {
  private readonly baseUrl: string
  private readonly internalKey: string
  private readonly tenantId: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: DataOsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.internalKey = options.internalKey
    this.tenantId = options.tenantId
    this.timeoutMs = options.timeoutMs ?? 5000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T | null> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    const method = init.method ?? 'GET'
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-DataOS-Internal-Key': this.internalKey,
          'X-Tenant-Id': this.tenantId,
          ...(init.headers as Record<string, string>),
        },
      })
      if (!res.ok) {
        console.warn(`[dataos-client] ${method} ${path} → HTTP ${res.status}`)
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      const reason = ctrl.signal.aborted
        ? `timeout after ${this.timeoutMs}ms`
        : err instanceof Error ? err.message : String(err)
      console.warn(`[dataos-client] ${method} ${path} → ${reason}`)
      return null
    } finally {
      clearTimeout(t)
    }
  }

  async recordLakeEvent(body: DataOsLakeEventPayload): Promise<boolean> {
    const r = await this.request<{ ok?: boolean }>('/internal/v1/lake/events', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return r !== null && r.ok !== false
  }

  async recordPriceEvent(body: {
    tenantId: string
    platform?: string
    productId: string
    priceBefore: number
    priceAfter: number
    changePct: number
    approved: boolean
  }): Promise<boolean> {
    const r = await this.request<{ ok?: boolean }>('/internal/v1/lake/price-events', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return r !== null && r.ok !== false
  }

  async queryEvents(opts?: {
    agentId?: string; eventType?: string; entityId?: string; limit?: number; sinceMs?: number
  }): Promise<unknown[]> {
    const qs = new URLSearchParams()
    if (opts?.agentId) qs.set('agentId', opts.agentId)
    if (opts?.eventType) qs.set('eventType', opts.eventType)
    if (opts?.entityId) qs.set('entityId', opts.entityId)
    if (opts?.limit) qs.set('limit', String(opts.limit))
    if (opts?.sinceMs) qs.set('sinceMs', String(opts.sinceMs))
    const r = await this.request<{ events?: unknown[] }>(`/internal/v1/lake/events?${qs}`, { method: 'GET' })
    return r?.events ?? []
  }

  async queryPriceEvents(opts?: {
    productId?: string; limit?: number; sinceMs?: number
  }): Promise<unknown[]> {
    const qs = new URLSearchParams()
    if (opts?.productId) qs.set('productId', opts.productId)
    if (opts?.limit) qs.set('limit', String(opts.limit))
    if (opts?.sinceMs) qs.set('sinceMs', String(opts.sinceMs))
    const r = await this.request<{ events?: unknown[] }>(`/internal/v1/lake/price-events?${qs}`, { method: 'GET' })
    return r?.events ?? []
  }

  async listFeatures(platform?: string, opts?: { limit?: number; offset?: number }): Promise<unknown[]> {
    const qs = new URLSearchParams()
    if (platform) qs.set('platform', platform)
    if (opts?.limit) qs.set('limit', String(opts.limit))
    if (opts?.offset) qs.set('offset', String(opts.offset))
    const r = await this.request<{ features?: unknown[] }>(`/internal/v1/features?${qs}`, { method: 'GET' })
    return r?.features ?? []
  }

  async deleteFeature(platform: string, productId: string): Promise<boolean> {
    const path = `/internal/v1/features/${encodeURIComponent(platform)}/${encodeURIComponent(productId)}`
    const r = await this.request<{ ok?: boolean; deleted?: boolean }>(path, { method: 'DELETE' })
    return r?.deleted ?? false
  }

  async listDecisions(agentId?: string, limit?: number): Promise<unknown[]> {
    const qs = new URLSearchParams()
    if (agentId) qs.set('agentId', agentId)
    if (limit) qs.set('limit', String(limit))
    const r = await this.request<{ decisions?: unknown[] }>(`/internal/v1/memory/decisions?${qs}`, { method: 'GET' })
    return r?.decisions ?? []
  }

  async deleteDecision(decisionId: string): Promise<boolean> {
    const path = `/internal/v1/memory/decisions/${encodeURIComponent(decisionId)}`
    const r = await this.request<{ ok?: boolean; deleted?: boolean }>(path, { method: 'DELETE' })
    return r?.deleted ?? false
  }

  async getFeatures(platform: string, productId: string): Promise<ProductFeaturesSnapshot | null> {
    const path = `/internal/v1/features/${encodeURIComponent(platform)}/${encodeURIComponent(productId)}`
    return this.request<ProductFeaturesSnapshot>(path, { method: 'GET' })
  }

  async recallMemory(
    agentId: string,
    context: unknown,
    opts?: { limit?: number; minSimilarity?: number },
  ): Promise<unknown[] | null> {
    const r = await this.request<{ memories?: unknown[] }>('/internal/v1/memory/recall', {
      method: 'POST',
      body: JSON.stringify({ agentId, context, ...opts }),
    })
    return r?.memories ?? null
  }

  async recordMemory(body: {
    agentId: string
    platform?: string
    entityId?: string
    context: unknown
    action: unknown
  }): Promise<string | null> {
    const r = await this.request<{ id?: string }>('/internal/v1/memory/record', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return r?.id ?? null
  }

  async writeOutcome(decisionId: string, outcome: unknown): Promise<boolean> {
    const r = await this.request<{ ok?: boolean }>('/internal/v1/memory/outcome', {
      method: 'POST',
      body: JSON.stringify({ tenantId: this.tenantId, decisionId, outcome }),
    })
    return r !== null && r.ok !== false
  }

  async upsertFeature(input: {
    platform: string
    productId: string
    [key: string]: unknown
  }): Promise<boolean> {
    const r = await this.request<{ ok?: boolean }>('/internal/v1/features/upsert', {
      method: 'POST',
      body: JSON.stringify({ tenantId: this.tenantId, ...input }),
    })
    return r !== null && r.ok !== false
  }

  async getCapabilities(): Promise<DataOsCapabilities | null> {
    return this.request<DataOsCapabilities>('/internal/v1/capabilities', { method: 'GET' })
  }
}

export function createDataOsClientFromEnv(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): DataOsClient | null {
  const baseUrl = env.DATAOS_API_URL
  const internalKey = env.DATAOS_INTERNAL_KEY
  if (!baseUrl || !internalKey || env.DATAOS_ENABLED === '0') {
    return null
  }
  return new DataOsClient({
    baseUrl,
    internalKey,
    tenantId,
    timeoutMs: env.DATAOS_TIMEOUT_MS ? Number.parseInt(env.DATAOS_TIMEOUT_MS, 10) : 5000,
  })
}
