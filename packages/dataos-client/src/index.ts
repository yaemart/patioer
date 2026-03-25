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
    init: RequestInit & { parseJson?: boolean } = {},
  ): Promise<T | null> {
    const { parseJson = true, ...rest } = init
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...rest,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-DataOS-Internal-Key': this.internalKey,
          'X-Tenant-Id': this.tenantId,
          ...(rest.headers as Record<string, string>),
        },
      })
      if (!res.ok) {
        return null
      }
      if (!parseJson) return null as T
      return (await res.json()) as T
    } catch {
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

  async getFeatures(platform: string, productId: string): Promise<ProductFeaturesSnapshot | null> {
    const path = `/internal/v1/features/${encodeURIComponent(platform)}/${encodeURIComponent(productId)}`
    return this.request<ProductFeaturesSnapshot>(path, { method: 'GET' })
  }

  async recallMemory(agentId: string, context: unknown): Promise<unknown[] | null> {
    const r = await this.request<{ memories?: unknown[] }>('/internal/v1/memory/recall', {
      method: 'POST',
      body: JSON.stringify({ agentId, context }),
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
