import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool, withTenantDb } from './client.js'
import * as schema from './schema/index.js'
import { eq } from 'drizzle-orm'

const TENANT_A_SLUG = `rls-test-a-${Date.now()}`
const TENANT_B_SLUG = `rls-test-b-${Date.now()}`

let tenantAId: string
let tenantBId: string

const isIntegration = !!process.env.DATABASE_URL

describe.skipIf(!isIntegration)('agents RLS cross-tenant isolation', () => {
  beforeAll(async () => {
    const [rowA] = await db
      .insert(schema.tenants)
      .values({ name: 'RLS Test A', slug: TENANT_A_SLUG })
      .returning()
    tenantAId = rowA!.id

    const [rowB] = await db
      .insert(schema.tenants)
      .values({ name: 'RLS Test B', slug: TENANT_B_SLUG })
      .returning()
    tenantBId = rowB!.id

    await withTenantDb(tenantAId, async (tdb) => {
      await tdb.insert(schema.agents).values({
        tenantId: tenantAId,
        name: 'Agent Alpha',
        type: 'price-sentinel',
        status: 'active',
      })
    })

    await withTenantDb(tenantBId, async (tdb) => {
      await tdb.insert(schema.agents).values({
        tenantId: tenantBId,
        name: 'Agent Bravo',
        type: 'product-scout',
        status: 'active',
      })
    })
  })

  afterAll(async () => {
    await db.delete(schema.agents).where(eq(schema.agents.tenantId, tenantAId))
    await db.delete(schema.agents).where(eq(schema.agents.tenantId, tenantBId))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantAId))
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantBId))
    await pool.end()
  })

  it('tenant A sees only its own agents', async () => {
    const rows = await withTenantDb(tenantAId, (tdb) =>
      tdb.select().from(schema.agents),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.name).toBe('Agent Alpha')
    expect(rows[0]!.tenantId).toBe(tenantAId)
  })

  it('tenant B sees only its own agents', async () => {
    const rows = await withTenantDb(tenantBId, (tdb) =>
      tdb.select().from(schema.agents),
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.name).toBe('Agent Bravo')
    expect(rows[0]!.tenantId).toBe(tenantBId)
  })

  it('tenant A cannot read tenant B agent by id', async () => {
    const [bAgent] = await withTenantDb(tenantBId, (tdb) =>
      tdb.select().from(schema.agents),
    )

    const rows = await withTenantDb(tenantAId, (tdb) =>
      tdb
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, bAgent!.id)),
    )
    expect(rows).toEqual([])
  })

  it('tenant B cannot update tenant A agent', async () => {
    const [aAgent] = await withTenantDb(tenantAId, (tdb) =>
      tdb.select().from(schema.agents),
    )

    const updated = await withTenantDb(tenantBId, (tdb) =>
      tdb
        .update(schema.agents)
        .set({ name: 'HACKED' })
        .where(eq(schema.agents.id, aAgent!.id))
        .returning(),
    )
    expect(updated).toEqual([])

    const [unchanged] = await withTenantDb(tenantAId, (tdb) =>
      tdb.select().from(schema.agents),
    )
    expect(unchanged!.name).toBe('Agent Alpha')
  })

  it('tenant B cannot delete tenant A agent', async () => {
    const [aAgent] = await withTenantDb(tenantAId, (tdb) =>
      tdb.select().from(schema.agents),
    )

    const deleted = await withTenantDb(tenantBId, (tdb) =>
      tdb
        .delete(schema.agents)
        .where(eq(schema.agents.id, aAgent!.id))
        .returning(),
    )
    expect(deleted).toEqual([])

    const rows = await withTenantDb(tenantAId, (tdb) =>
      tdb.select().from(schema.agents),
    )
    expect(rows.length).toBe(1)
  })
})
