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
  private readonly database: string

  constructor(cfg: EventLakeConfig) {
    this.database = cfg.database ?? 'electroos_events'
    this.client = createClient({
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      database: this.database,
    })
  }

  get raw(): ClickHouseClient {
    return this.client
  }

  async insertEvent(row: DataOsEventLakeRecord): Promise<void> {
    const payload =
      typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload ?? {})
    const metadata =
      typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata ?? {})
    await this.client.insert({
      table: 'events',
      values: [
        {
          tenant_id: row.tenantId,
          platform: row.platform ?? '',
          agent_id: row.agentId,
          event_type: row.eventType,
          entity_id: row.entityId ?? '',
          payload,
          metadata,
        },
      ],
      format: 'JSONEachRow',
    })
  }

  async insertPriceEvent(row: DataOsPriceEventRecord): Promise<void> {
    await this.client.insert({
      table: 'price_events',
      values: [
        {
          tenant_id: row.tenantId,
          platform: row.platform ?? '',
          product_id: row.productId,
          price_before: row.priceBefore,
          price_after: row.priceAfter,
          change_pct: row.changePct,
          approved: row.approved ? 1 : 0,
          conv_rate_7d: row.convRate7d ?? 0,
          revenue_7d: row.revenue7d ?? 0,
        },
      ],
      format: 'JSONEachRow',
    })
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
