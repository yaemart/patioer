/**
 * Staging seed: creates demo tenants + agents in an empty database.
 * Designed for docker-compose staging pipeline — runs after migrate + RLS.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING so re-runs are safe.
 */
import { eq } from 'drizzle-orm'
import { db, withTenantDb, schema, pool } from '@patioer/db'

const DEMO_TENANTS = [
  { name: 'Acme Electronics', slug: 'acme-electronics', plan: 'starter' },
  { name: 'Widget Co', slug: 'widget-co', plan: 'starter' },
]

const AGENT_SPECS = [
  { name: 'Product Scout', type: 'product-scout' as const, goalContext: '{"mode":"daily-scan","runAt":"06:00"}' },
  { name: 'Price Sentinel', type: 'price-sentinel' as const, goalContext: '{"approvalThresholdPercent":15,"proposals":[]}' },
  { name: 'Support Relay', type: 'support-relay' as const, goalContext: '{"policy":"auto_reply_non_refund"}' },
]

async function main() {
  console.log('[seed] Starting staging seed...')

  const tenantIds: string[] = []

  for (const t of DEMO_TENANTS) {
    const rows = await db
      .insert(schema.tenants)
      .values(t)
      .onConflictDoNothing()
      .returning({ id: schema.tenants.id })

    if (rows.length > 0) {
      tenantIds.push(rows[0]!.id)
      console.log(`[seed] Created tenant "${t.name}" → ${rows[0]!.id}`)
    } else {
      const [found] = await db
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, t.slug))
      if (found) {
        tenantIds.push(found.id)
        console.log(`[seed] Tenant "${t.name}" already exists → ${found.id}`)
      }
    }
  }

  for (const tenantId of tenantIds) {
    await withTenantDb(tenantId, async (tdb) => {
      for (const spec of AGENT_SPECS) {
        const inserted = await tdb
          .insert(schema.agents)
          .values({
            tenantId,
            name: spec.name,
            type: spec.type,
            status: 'active',
            goalContext: spec.goalContext,
          })
          .onConflictDoNothing()
          .returning({ id: schema.agents.id })

        if (inserted.length > 0) {
          console.log(`[seed]   Agent "${spec.name}" → ${inserted[0]!.id}`)
        } else {
          console.log(`[seed]   Agent "${spec.name}" already exists, skipped`)
        }
      }
    })
  }

  console.log(`[seed] Done. ${tenantIds.length} tenants, ${AGENT_SPECS.length} agents each.`)
  await pool.end()
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
