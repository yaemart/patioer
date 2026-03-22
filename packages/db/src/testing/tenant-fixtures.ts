import { eq } from 'drizzle-orm'
import { db, pool, withTenantDb } from '../client.js'
import * as schema from '../schema/index.js'

export interface TenantFixture {
  tenantAId: string
  tenantBId: string
}

export interface SeedResult {
  agentId: string
  productId: string
  orderId: string
  eventId: string
  approvalId: string
  credentialId: string
}

const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export async function setupTwoTenants(): Promise<TenantFixture> {
  const tag = suffix()

  const [rowA] = await db
    .insert(schema.tenants)
    .values({ name: 'E2E Tenant A', slug: `e2e-a-${tag}` })
    .returning()

  const [rowB] = await db
    .insert(schema.tenants)
    .values({ name: 'E2E Tenant B', slug: `e2e-b-${tag}` })
    .returning()

  return { tenantAId: rowA!.id, tenantBId: rowB!.id }
}

export async function seedTenantData(
  tenantId: string,
  label: string,
): Promise<SeedResult> {
  return withTenantDb(tenantId, async (tdb) => {
    const [cred] = await tdb
      .insert(schema.platformCredentials)
      .values({
        tenantId,
        platform: 'shopify',
        region: 'global',
        shopDomain: `${label}.myshopify.com`,
        accessToken: `enc-token-${label}`,
      })
      .returning()

    const [agent] = await tdb
      .insert(schema.agents)
      .values({
        tenantId,
        name: `Agent ${label}`,
        type: 'price-sentinel',
        status: 'active',
      })
      .returning()

    const [product] = await tdb
      .insert(schema.products)
      .values({
        tenantId,
        platformProductId: `pid-${label}`,
        platform: 'shopify',
        title: `Product ${label}`,
        price: '29.99',
      })
      .returning()

    const [order] = await tdb
      .insert(schema.orders)
      .values({
        tenantId,
        platformOrderId: `oid-${label}`,
        platform: 'shopify',
        status: 'fulfilled',
        totalPrice: '59.99',
      })
      .returning()

    const [event] = await tdb
      .insert(schema.agentEvents)
      .values({
        tenantId,
        agentId: agent!.id,
        action: 'test.seed',
        payload: { label },
      })
      .returning()

    const [approval] = await tdb
      .insert(schema.approvals)
      .values({
        tenantId,
        agentId: agent!.id,
        action: 'price.change',
        payload: { label },
        status: 'pending',
      })
      .returning()

    return {
      agentId: agent!.id,
      productId: product!.id,
      orderId: order!.id,
      eventId: event!.id,
      approvalId: approval!.id,
      credentialId: cred!.id,
    }
  })
}

export async function teardownTwoTenants(fixture: TenantFixture): Promise<void> {
  const ids = [fixture.tenantAId, fixture.tenantBId]

  for (const tenantId of ids) {
    await withTenantDb(tenantId, async (tdb) => {
      await tdb.delete(schema.approvals).where(eq(schema.approvals.tenantId, tenantId))
      await tdb.delete(schema.agentEvents).where(eq(schema.agentEvents.tenantId, tenantId))
      await tdb.delete(schema.agents).where(eq(schema.agents.tenantId, tenantId))
      await tdb.delete(schema.products).where(eq(schema.products.tenantId, tenantId))
      await tdb.delete(schema.orders).where(eq(schema.orders.tenantId, tenantId))
      await tdb
        .delete(schema.platformCredentials)
        .where(eq(schema.platformCredentials.tenantId, tenantId))
    })
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId))
  }
}

export async function closePool(): Promise<void> {
  await pool.end()
}
