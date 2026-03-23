import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { withTenantDb } from './client.js'
import * as schema from './schema/index.js'
import {
  closePool,
  seedTenantData,
  setupTwoTenants,
  teardownTwoTenants,
  type SeedResult,
  type TenantFixture,
} from './testing/tenant-fixtures.js'

const isIntegration = !!process.env.DATABASE_URL

describe.skipIf(!isIntegration)('RLS cross-tenant isolation — all business tables', () => {
  let fix: TenantFixture
  let seedA: SeedResult
  let seedB: SeedResult

  beforeAll(async () => {
    fix = await setupTwoTenants()
    seedA = await seedTenantData(fix.tenantAId, 'alpha')
    seedB = await seedTenantData(fix.tenantBId, 'bravo')
  })

  afterAll(async () => {
    await teardownTwoTenants(fix)
    await closePool()
  })

  // ── products ──────────────────────────────────────────────

  describe('products', () => {
    it('tenant A sees only own products', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.products),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.productId)
    })

    it('tenant B sees only own products', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.select().from(schema.products),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedB.productId)
    })

    it('tenant A cannot read tenant B product by id', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, seedB.productId)),
      )
      expect(rows).toEqual([])
    })

    it('tenant B cannot update tenant A product', async () => {
      const updated = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .update(schema.products)
          .set({ title: 'HACKED' })
          .where(eq(schema.products.id, seedA.productId))
          .returning(),
      )
      expect(updated).toEqual([])
    })

    it('tenant B cannot delete tenant A product', async () => {
      const deleted = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .delete(schema.products)
          .where(eq(schema.products.id, seedA.productId))
          .returning(),
      )
      expect(deleted).toEqual([])
    })
  })

  // ── orders ────────────────────────────────────────────────

  describe('orders', () => {
    it('tenant A sees only own orders', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.orders),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.orderId)
    })

    it('tenant B sees only own orders', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.select().from(schema.orders),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedB.orderId)
    })

    it('tenant A cannot read tenant B order by id', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.id, seedB.orderId)),
      )
      expect(rows).toEqual([])
    })
  })

  // ── platform_credentials ──────────────────────────────────

  describe('platform_credentials', () => {
    it('tenant A sees only own credentials', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.platformCredentials),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.credentialId)
    })

    it('tenant B cannot read tenant A credential by id', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .select()
          .from(schema.platformCredentials)
          .where(eq(schema.platformCredentials.id, seedA.credentialId)),
      )
      expect(rows).toEqual([])
    })
  })

  // ── ads_campaigns ─────────────────────────────────────────

  describe('ads_campaigns', () => {
    it('tenant A sees only own campaigns', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.adsCampaigns),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.adsCampaignId)
    })

    it('tenant B cannot read tenant A campaign by id', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .select()
          .from(schema.adsCampaigns)
          .where(eq(schema.adsCampaigns.id, seedA.adsCampaignId)),
      )
      expect(rows).toEqual([])
    })
  })

  // ── inventory_levels ──────────────────────────────────────

  describe('inventory_levels', () => {
    it('tenant A sees only own inventory rows', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.inventoryLevels),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.inventoryLevelId)
    })

    it('tenant B cannot read tenant A inventory by id', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .select()
          .from(schema.inventoryLevels)
          .where(eq(schema.inventoryLevels.id, seedA.inventoryLevelId)),
      )
      expect(rows).toEqual([])
    })
  })

  // ── agent_events ──────────────────────────────────────────

  describe('agent_events', () => {
    it('tenant A sees only own events', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.agentEvents),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.eventId)
    })

    it('tenant B cannot read tenant A events', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .select()
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.id, seedA.eventId)),
      )
      expect(rows).toEqual([])
    })
  })

  // ── approvals ─────────────────────────────────────────────

  describe('approvals', () => {
    it('tenant A sees only own approvals', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.approvals),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.approvalId)
    })

    it('tenant B cannot resolve tenant A approval', async () => {
      const updated = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .update(schema.approvals)
          .set({ status: 'approved', resolvedBy: 'HACKER' })
          .where(eq(schema.approvals.id, seedA.approvalId))
          .returning(),
      )
      expect(updated).toEqual([])
    })
  })

  // ── agents ────────────────────────────────────────────────

  describe('agents', () => {
    it('tenant A sees only own agents', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.agents),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedA.agentId)
    })

    it('tenant B sees only own agents', async () => {
      const rows = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.select().from(schema.agents),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(seedB.agentId)
    })

    it('tenant A cannot read tenant B agent by id', async () => {
      const rows = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, seedB.agentId)),
      )
      expect(rows).toEqual([])
    })

    it('tenant B cannot update tenant A agent', async () => {
      const updated = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .update(schema.agents)
          .set({ name: 'HACKED' })
          .where(eq(schema.agents.id, seedA.agentId))
          .returning(),
      )
      expect(updated).toEqual([])
    })

    it('tenant B cannot delete tenant A agent', async () => {
      const deleted = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb
          .delete(schema.agents)
          .where(eq(schema.agents.id, seedA.agentId))
          .returning(),
      )
      expect(deleted).toEqual([])
    })
  })

  // ── devos_tickets（tenant_id 可空：系统级 Ticket 全租户可见）────

  describe('devos_tickets', () => {
    it('RLS: system rows visible to all tenants; scoped rows isolated', async () => {
      await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.insert(schema.devosTickets).values({
          tenantId: fix.tenantAId,
          type: 'bug',
          priority: 'P1',
          title: 'a-only',
          description: 'd',
        }),
      )
      await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.insert(schema.devosTickets).values({
          tenantId: null,
          type: 'performance',
          priority: 'P0',
          title: 'system',
          description: 'd',
        }),
      )
      await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.insert(schema.devosTickets).values({
          tenantId: fix.tenantBId,
          type: 'feature',
          priority: 'P2',
          title: 'b-only',
          description: 'd',
        }),
      )

      const rowsA = await withTenantDb(fix.tenantAId, (tdb) =>
        tdb.select().from(schema.devosTickets),
      )
      expect(rowsA.map((r) => r.title).sort()).toEqual(['a-only', 'system'])

      const rowsB = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.select().from(schema.devosTickets),
      )
      expect(rowsB.map((r) => r.title).sort()).toEqual(['b-only', 'system'])

      const aScoped = rowsA.find((r) => r.title === 'a-only')
      expect(aScoped).toBeDefined()
      const leak = await withTenantDb(fix.tenantBId, (tdb) =>
        tdb.select().from(schema.devosTickets).where(eq(schema.devosTickets.id, aScoped!.id)),
      )
      expect(leak).toEqual([])
    })
  })

  // ── AC-07: bare SELECT with wrong tenant context ──────────

  describe('bare SELECT with non-existent tenant context returns empty', () => {
    const phantomTenantId = '00000000-0000-0000-0000-000000000000'

    it('products table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.products),
      )
      expect(rows).toEqual([])
    })

    it('agents table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.agents),
      )
      expect(rows).toEqual([])
    })

    it('orders table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.orders),
      )
      expect(rows).toEqual([])
    })

    it('approvals table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.approvals),
      )
      expect(rows).toEqual([])
    })

    it('agent_events table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.agentEvents),
      )
      expect(rows).toEqual([])
    })

    it('platform_credentials table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.platformCredentials),
      )
      expect(rows).toEqual([])
    })

    it('ads_campaigns table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.adsCampaigns),
      )
      expect(rows).toEqual([])
    })

    it('inventory_levels table returns empty', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.inventoryLevels),
      )
      expect(rows).toEqual([])
    })

    it('devos_tickets returns only system rows (tenant_id IS NULL)', async () => {
      const rows = await withTenantDb(phantomTenantId, (tdb) =>
        tdb.select().from(schema.devosTickets),
      )
      expect(rows.every((r) => r.tenantId === null)).toBe(true)
    })
  })
})
