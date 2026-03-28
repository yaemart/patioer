import { createClient, type ClickHouseClient } from '@clickhouse/client'
import type { DataOsEventLakeRecord, DataOsPriceEventRecord } from './types.js'

export interface EventLakeConfig {
  url: string
  username?: string
  password?: string
  database?: string
}

export class EventLakeService {
  private readonly client: ClickHouseClient

  constructor(cfg: EventLakeConfig) {
    const database = cfg.database ?? 'electroos_events'
    this.client = createClient({
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      database,
    })
  }

  private serializeEvent(row: DataOsEventLakeRecord) {
    return {
      tenant_id: row.tenantId,
      platform: row.platform ?? '',
      agent_id: row.agentId,
      event_type: row.eventType,
      entity_id: row.entityId ?? '',
      payload: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload ?? {}),
      metadata:
        typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata ?? {}),
    }
  }

  async insertEvent(row: DataOsEventLakeRecord): Promise<void> {
    await this.insertEventBatch([row])
  }

  async insertEventBatch(rows: DataOsEventLakeRecord[]): Promise<void> {
    if (rows.length === 0) return
    await this.client.insert({
      table: 'events',
      values: rows.map((r) => this.serializeEvent(r)),
      format: 'JSONEachRow',
    })
  }

  async insertPriceEvent(row: DataOsPriceEventRecord): Promise<void> {
    await this.insertPriceEventBatch([row])
  }

  async insertPriceEventBatch(rows: DataOsPriceEventRecord[]): Promise<void> {
    if (rows.length === 0) return
    await this.client.insert({
      table: 'price_events',
      values: rows.map((row) => ({
        tenant_id: row.tenantId,
        platform: row.platform ?? '',
        product_id: row.productId,
        price_before: row.priceBefore,
        price_after: row.priceAfter,
        change_pct: row.changePct,
        approved: row.approved ? 1 : 0,
        conv_rate_7d: row.convRate7d ?? 0,
        revenue_7d: row.revenue7d ?? 0,
      })),
      format: 'JSONEachRow',
    })
  }

  async queryEvents(
    tenantId: string,
    opts?: { agentId?: string; eventType?: string; entityId?: string; limit?: number; sinceMs?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const conditions = ['tenant_id = {tenantId:UUID}']
    const params: Record<string, unknown> = { tenantId }
    if (opts?.agentId) {
      conditions.push('agent_id = {agentId:String}')
      params.agentId = opts.agentId
    }
    if (opts?.eventType) {
      conditions.push('event_type = {eventType:String}')
      params.eventType = opts.eventType
    }
    if (opts?.entityId) {
      conditions.push('entity_id = {entityId:String}')
      params.entityId = opts.entityId
    }
    if (opts?.sinceMs) {
      conditions.push('created_at >= fromUnixTimestamp64Milli({sinceMs:UInt64})')
      params.sinceMs = opts.sinceMs
    }
    const limit = Math.min(opts?.limit ?? 50, 500)
    const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT {limit:UInt32}`
    params.limit = limit
    const res = await this.client.query({ query: sql, query_params: params, format: 'JSONEachRow' })
    return (await res.json()) as Array<Record<string, unknown>>
  }

  async queryPriceEvents(
    tenantId: string,
    opts?: { productId?: string; limit?: number; sinceMs?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const conditions = ['tenant_id = {tenantId:UUID}']
    const params: Record<string, unknown> = { tenantId }
    if (opts?.productId) {
      conditions.push('product_id = {productId:String}')
      params.productId = opts.productId
    }
    if (opts?.sinceMs) {
      conditions.push('created_at >= fromUnixTimestamp64Milli({sinceMs:UInt64})')
      params.sinceMs = opts.sinceMs
    }
    const limit = Math.min(opts?.limit ?? 50, 500)
    const sql = `SELECT * FROM price_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT {limit:UInt32}`
    params.limit = limit
    const res = await this.client.query({ query: sql, query_params: params, format: 'JSONEachRow' })
    return (await res.json()) as Array<Record<string, unknown>>
  }

  async aggregateRecentEntityEvents(opts?: {
    intervalDays?: number; limit?: number; tenantId?: string
  }): Promise<Array<{ tenant_id: string; platform: string; product_id: string; evts: string }>> {
    const days = opts?.intervalDays ?? 1
    const limit = Math.min(opts?.limit ?? 500, 2000)
    const params: Record<string, unknown> = { days, limit }
    let tenantFilter = ''
    if (opts?.tenantId) {
      params.tenantId = opts.tenantId
      tenantFilter = ' AND tenant_id = {tenantId:UUID}'
    }
    const res = await this.client.query({
      query: `SELECT tenant_id, platform, entity_id AS product_id, count() AS evts
              FROM events
              WHERE created_at > now() - INTERVAL {days:UInt32} DAY
                AND entity_id != ''
                AND platform != ''${tenantFilter}
              GROUP BY tenant_id, platform, entity_id
              LIMIT {limit:UInt32}`,
      query_params: params,
      format: 'JSONEachRow',
    })
    return (await res.json()) as Array<{ tenant_id: string; platform: string; product_id: string; evts: string }>
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
