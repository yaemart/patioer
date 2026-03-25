import type { DataOsServices } from '@patioer/dataos'

/**
 * Every 15 minutes: aggregate recent price-related events from ClickHouse and refresh Feature Store rows.
 * When ClickHouse is empty, no-op.
 */
export function startFeatureAgentInterval(services: DataOsServices, ms: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void runFeatureAgentTick(services).catch((err) => console.error('[dataos-feature-agent]', err))
  }, ms)
}

async function runFeatureAgentTick(services: DataOsServices): Promise<void> {
  const ch = services.eventLake.raw
  const res = await ch.query({
    query: `
      SELECT
        tenant_id,
        max(platform) AS platform,
        entity_id AS product_id,
        count() AS evts
      FROM events
      WHERE created_at > now() - INTERVAL 1 DAY
        AND entity_id != ''
      GROUP BY tenant_id, entity_id
      LIMIT 500
    `,
    format: 'JSONEachRow',
  })
  const rows = (await res.json()) as Array<{
    tenant_id: string
    platform: string
    product_id: string
    evts: string
  }>
  for (const row of rows) {
    await services.featureStore.upsert({
      tenantId: row.tenant_id,
      platform: row.platform || 'unknown',
      productId: row.product_id,
      convRate7d: Math.min(1, Number(row.evts) / 100),
    })
  }
}
