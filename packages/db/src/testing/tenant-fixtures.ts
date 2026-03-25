import { eq, isNull } from 'drizzle-orm'
import { db, pool, withTenantDb } from '../client.js'
import * as schema from '../schema/index.js'

export interface TenantFixture {
  tenantAId: string
  tenantBId: string
}

export interface SeedResult {
  agentId: string
  agentIds: string[]
  productId: string
  orderId: string
  eventId: string
  approvalId: string
  credentialId: string
  credentialIds: string[]
  adsCampaignId: string
  inventoryLevelId: string
}

export interface SeedTenantOptions {
  credentialsPlatforms?: string[]
  dataPlatform?: string
  agentCount?: number
}

const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/**
 * Non-existent tenant UUID used only for teardown: under `devos_tickets` RLS, this
 * context can see rows with `tenant_id IS NULL` (system) but not other tenants'
 * scoped rows — same idea as `rls-all-tables.integration.test.ts` phantom tenant.
 */
const DEVOS_SYSTEM_CLEANUP_TENANT_ID = '00000000-0000-0000-0000-000000000000'

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
  options: SeedTenantOptions = {},
): Promise<SeedResult> {
  return withTenantDb(tenantId, async (tdb) => {
    const credentialsPlatforms = options.credentialsPlatforms ?? ['shopify']
    const dataPlatform = options.dataPlatform ?? credentialsPlatforms[0] ?? 'shopify'
    const agentCount = Math.max(1, options.agentCount ?? 1)

    const credentials: { id: string }[] = []

    for (const platform of credentialsPlatforms) {
      const region = platform === 'amazon' ? 'NA' : platform === 'shopee' ? 'SG' : 'global'

      const shopDomain = platform === 'shopify' ? `${label}.myshopify.com` : null
      const credentialType = platform === 'amazon' ? 'lwa' : platform === 'shopify' ? 'oauth' : 'hmac'

      const [cred] = await tdb
        .insert(schema.platformCredentials)
        .values({
          tenantId,
          platform,
          credentialType,
          region,
          shopDomain,
          accessToken: `enc-token-${label}-${platform}`,
          metadata: { seededBy: 'seedTenantData', label, platform },
        })
        .returning()

      credentials.push({ id: cred!.id })
    }

    const agentRows: { id: string }[] = []
    for (let i = 0; i < agentCount; i += 1) {
      const [agent] = await tdb
        .insert(schema.agents)
        .values({
          tenantId,
          name: `Agent ${label}-${i + 1}`,
          type: 'price-sentinel',
          status: 'active',
        })
        .returning()
      agentRows.push({ id: agent!.id })
    }
    const agentId = agentRows[0]!.id

    const [product] = await tdb
      .insert(schema.products)
      .values({
        tenantId,
        platformProductId: `pid-${label}-${dataPlatform}`,
        platform: dataPlatform,
        title: `Product ${label}`,
        price: '29.99',
      })
      .returning()

    const [adsCampaign] = await tdb
      .insert(schema.adsCampaigns)
      .values({
        tenantId,
        platform: dataPlatform,
        platformCampaignId: `camp-${label}-${dataPlatform}`,
        name: `Campaign ${label}`,
        status: 'active',
        dailyBudget: '100.00',
        totalSpend: '0',
        roas: '2.50',
      })
      .returning()

    const [inventoryLevel] = await tdb
      .insert(schema.inventoryLevels)
      .values({
        tenantId,
        productId: product!.id,
        platform: dataPlatform,
        quantity: 12,
        safetyThreshold: 10,
        status: 'normal',
      })
      .returning()

    const [order] = await tdb
      .insert(schema.orders)
      .values({
        tenantId,
        platformOrderId: `oid-${label}-${dataPlatform}`,
        platform: dataPlatform,
        status: 'fulfilled',
        totalPrice: '59.99',
      })
      .returning()

    const [event] = await tdb
      .insert(schema.agentEvents)
      .values({
        tenantId,
        agentId,
        action: 'test.seed',
        payload: { label },
      })
      .returning()

    const [approval] = await tdb
      .insert(schema.approvals)
      .values({
        tenantId,
        agentId,
        action: 'price.change',
        payload: { label },
        status: 'pending',
      })
      .returning()

    return {
      agentId,
      agentIds: agentRows.map((a) => a.id),
      productId: product!.id,
      orderId: order!.id,
      eventId: event!.id,
      approvalId: approval!.id,
      credentialId: credentials[0]!.id,
      credentialIds: credentials.map((c) => c.id),
      adsCampaignId: adsCampaign!.id,
      inventoryLevelId: inventoryLevel!.id,
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
      await tdb.delete(schema.devosTickets).where(eq(schema.devosTickets.tenantId, tenantId))
      await tdb.delete(schema.inventoryLevels).where(eq(schema.inventoryLevels.tenantId, tenantId))
      await tdb.delete(schema.adsCampaigns).where(eq(schema.adsCampaigns.tenantId, tenantId))
      await tdb.delete(schema.products).where(eq(schema.products.tenantId, tenantId))
      await tdb.delete(schema.orders).where(eq(schema.orders.tenantId, tenantId))
      await tdb
        .delete(schema.platformCredentials)
        .where(eq(schema.platformCredentials.tenantId, tenantId))
    })
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId))
  }

  // System-scope devos rows (tenant_id IS NULL): not tenant-scoped; clean once in a
  // context that only matches those rows (see DEVOS_SYSTEM_CLEANUP_TENANT_ID).
  await withTenantDb(DEVOS_SYSTEM_CLEANUP_TENANT_ID, async (tdb) => {
    await tdb.delete(schema.devosTickets).where(isNull(schema.devosTickets.tenantId))
  })
}

export async function closePool(): Promise<void> {
  await pool.end()
}
