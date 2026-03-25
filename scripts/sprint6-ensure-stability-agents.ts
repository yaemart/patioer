import pg from 'pg'

const TENANT_SLUG = 'sprint6-stability'
const TENANT_NAME = 'Sprint 6 Stability Tenant'

const TARGET_AGENT_TYPES = [
  'product-scout',
  'price-sentinel',
  'support-relay',
  'ads-optimizer',
  'inventory-guard',
] as const

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    await client.query('BEGIN')

    const tenantRes = await client.query<{ id: string }>(
      `
      insert into tenants (name, slug)
      values ($1, $2)
      on conflict (slug) do update set name = excluded.name
      returning id
      `,
      [TENANT_NAME, TENANT_SLUG],
    )
    const tenantId = tenantRes.rows[0]?.id
    if (!tenantId) throw new Error('failed to create or fetch tenant')

    let created = 0
    for (const type of TARGET_AGENT_TYPES) {
      const name = `S6 ${type}`
      const existing = await client.query<{ id: string }>(
        `select id from agents where tenant_id = $1 and type = $2 limit 1`,
        [tenantId, type],
      )
      if (existing.rowCount && (existing.rowCount ?? 0) > 0) {
        await client.query(`update agents set status = 'active' where id = $1`, [existing.rows[0]!.id])
        continue
      }

      await client.query(
        `
        insert into agents (tenant_id, name, type, status)
        values ($1, $2, $3, 'active')
        `,
        [tenantId, name, type],
      )
      created += 1
    }

    await client.query(
      `
      insert into agent_events (tenant_id, agent_id, action, payload)
      select a.tenant_id, a.id, 'stability.heartbeat', jsonb_build_object('source', 'day8-bootstrap')
      from agents a
      where a.tenant_id = $1 and a.status = 'active'
      `,
      [tenantId],
    )

    await client.query('COMMIT')

    const countRes = await client.query<{ v: number }>(
      `select count(*)::int as v from agents where tenant_id = $1 and status = 'active'`,
      [tenantId],
    )
    const activeAgents = countRes.rows[0]?.v ?? 0

    console.log(
      JSON.stringify(
        {
          tenantSlug: TENANT_SLUG,
          tenantId,
          createdAgents: created,
          activeAgents,
        },
        null,
        2,
      ),
    )
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[stability-agents] failed:', err)
  process.exit(1)
})
