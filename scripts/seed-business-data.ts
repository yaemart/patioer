/**
 * Seed script for Phase 5B business data tables.
 *
 * Usage: pnpm exec tsx scripts/seed-business-data.ts <tenant-uuid>
 *
 * Generates:
 * - 5 product snapshots used by inventory/ops pages
 * - 5 inventory_levels snapshots for dashboard + inventory alerts
 * - 30 days × 5 SKUs of unit_economics_daily
 * - 8 inventory_inbound_shipments
 * - 10 account_health_events
 * - 12 service_cases
 */

import { and, eq } from 'drizzle-orm'
import { db, schema, type AppDb, withTenantDb } from '@patioer/db'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: pnpm exec tsx scripts/seed-business-data.ts <tenant-uuid>')
  process.exit(1)
}

function randomBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600_000)
}

const SKUS = [
  {
    productId: 'SKU-WIDGET-A1',
    platform: 'amazon',
    title: 'Widget Pro A1',
    category: 'electronics',
    price: '29.99',
    quantity: 18,
    safetyThreshold: 10,
    status: 'normal' as const,
  },
  {
    productId: 'SKU-GADGET-B2',
    platform: 'amazon',
    title: 'Gadget B2',
    category: 'accessories',
    price: '49.99',
    quantity: 4,
    safetyThreshold: 8,
    status: 'low' as const,
  },
  {
    productId: 'SKU-CHARGER-C3',
    platform: 'shopify',
    title: 'Fast Charger C3',
    category: 'chargers',
    price: '15.99',
    quantity: 26,
    safetyThreshold: 12,
    status: 'normal' as const,
  },
  {
    productId: 'SKU-CABLE-D4',
    platform: 'tiktok',
    title: 'Cable D4',
    category: 'cables',
    price: '12.99',
    quantity: 0,
    safetyThreshold: 15,
    status: 'out_of_stock' as const,
  },
  {
    productId: 'SKU-SCREEN-E5',
    platform: 'shopee',
    title: 'Screen Guard E5',
    category: 'mobile_accessories',
    price: '189.99',
    quantity: 3,
    safetyThreshold: 6,
    status: 'low' as const,
  },
]

async function ensureTenantExists() {
  const [existing] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1)

  if (existing) {
    console.log('Tenant exists, continuing with seed...')
    return
  }

  const slug = `seed-${tenantId.slice(0, 8)}`
  await db.insert(schema.tenants).values({
    id: tenantId,
    name: `Seed Tenant ${tenantId.slice(0, 8)}`,
    slug,
    plan: 'starter',
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  })
  console.log(`Tenant created automatically (slug=${slug})`)
}

async function ensureCatalogProducts(tdb: AppDb): Promise<Map<string, string>> {
  console.log('Seeding product snapshots for UI pages...')
  const productIds = new Map<string, string>()

  for (const sku of SKUS) {
    const [existing] = await tdb
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(
        eq(schema.products.tenantId, tenantId),
        eq(schema.products.platform, sku.platform),
        eq(schema.products.platformProductId, sku.productId),
      ))
      .limit(1)

    if (existing) {
      productIds.set(sku.productId, existing.id)
      continue
    }

    const [created] = await tdb
      .insert(schema.products)
      .values({
        tenantId,
        platformProductId: sku.productId,
        platform: sku.platform,
        title: sku.title,
        category: sku.category,
        price: sku.price,
        syncedAt: new Date(),
      })
      .returning({ id: schema.products.id })

    if (!created) {
      throw new Error(`Failed to create product snapshot for ${sku.productId}`)
    }

    productIds.set(sku.productId, created.id)
  }

  console.log(`  → ${productIds.size} products ensured`)
  return productIds
}

async function seedInventoryLevels(tdb: AppDb, productIds: Map<string, string>) {
  console.log('Seeding inventory_levels...')
  let upserts = 0

  for (const sku of SKUS) {
    const productId = productIds.get(sku.productId)
    if (!productId) {
      throw new Error(`Missing product snapshot for ${sku.productId}`)
    }

    const [existing] = await tdb
      .select({ id: schema.inventoryLevels.id })
      .from(schema.inventoryLevels)
      .where(and(
        eq(schema.inventoryLevels.tenantId, tenantId),
        eq(schema.inventoryLevels.productId, productId),
        eq(schema.inventoryLevels.platform, sku.platform),
      ))
      .limit(1)

    if (existing) {
      await tdb
        .update(schema.inventoryLevels)
        .set({
          quantity: sku.quantity,
          safetyThreshold: sku.safetyThreshold,
          status: sku.status,
          syncedAt: new Date(),
        })
        .where(eq(schema.inventoryLevels.id, existing.id))
    } else {
      await tdb.insert(schema.inventoryLevels).values({
        tenantId,
        productId,
        platform: sku.platform,
        quantity: sku.quantity,
        safetyThreshold: sku.safetyThreshold,
        status: sku.status,
        syncedAt: new Date(),
      })
    }

    upserts += 1
  }

  console.log(`  → ${upserts} inventory snapshots ensured`)
}

async function seedUnitEconomics(tdb: AppDb) {
  console.log('Seeding unit_economics_daily (30 days × 5 SKUs)...')
  const rows = []

  for (let day = 0; day < 30; day++) {
    for (const sku of SKUS) {
      const grossRevenue = randomBetween(200, 2000)
      const platformFee = grossRevenue * randomBetween(0.08, 0.15)
      const shippingCost = randomBetween(5, 40)
      const refundAmount = Math.random() > 0.8 ? randomBetween(10, 100) : 0
      const netRevenue = grossRevenue - platformFee - refundAmount
      const cogs = grossRevenue * randomBetween(0.25, 0.45)
      const adSpend = randomBetween(20, 300)
      const contributionMargin = netRevenue - cogs - adSpend - shippingCost
      const unitsSold = Math.floor(randomBetween(5, 80))
      const acos = adSpend / Math.max(grossRevenue, 1)
      const tacos = adSpend / Math.max(netRevenue, 1)

      rows.push({
        tenantId,
        platform: sku.platform,
        productId: sku.productId,
        date: daysAgo(day),
        grossRevenue: String(grossRevenue),
        netRevenue: String(netRevenue),
        cogs: String(cogs),
        platformFee: String(platformFee),
        shippingCost: String(shippingCost),
        adSpend: String(adSpend),
        refundAmount: String(refundAmount),
        contributionMargin: String(contributionMargin),
        acos: String(Math.round(acos * 10000) / 10000),
        tacos: String(Math.round(tacos * 10000) / 10000),
        unitsSold,
      })
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await tdb.insert(schema.unitEconomicsDaily).values(rows.slice(i, i + 50))
  }
  console.log(`  → ${rows.length} rows inserted`)
}

async function seedInboundShipments(tdb: AppDb) {
  console.log('Seeding inventory_inbound_shipments...')
  const shipments = [
    { platform: 'amazon', productId: 'SKU-WIDGET-A1', shipmentId: 'SHP-001', quantity: 500, status: 'in_transit', expectedArrival: daysFromNow(5), supplier: 'Shenzhen Electronics Co.', leadTimeDays: 14, moq: 200, landedCostPerUnit: '3.50', totalCost: '1750.00' },
    { platform: 'amazon', productId: 'SKU-GADGET-B2', shipmentId: 'SHP-002', quantity: 300, status: 'in_transit', expectedArrival: daysFromNow(12), supplier: 'Dongguan Tech Parts', leadTimeDays: 21, moq: 100, landedCostPerUnit: '8.20', totalCost: '2460.00' },
    { platform: 'shopify', productId: 'SKU-CHARGER-C3', shipmentId: 'SHP-003', quantity: 1000, status: 'delivered', expectedArrival: daysAgo(2), supplier: 'Yiwu Power Solutions', leadTimeDays: 10, moq: 500, landedCostPerUnit: '1.80', totalCost: '1800.00' },
    { platform: 'tiktok', productId: 'SKU-CABLE-D4', shipmentId: 'SHP-004', quantity: 2000, status: 'delivered', expectedArrival: daysAgo(7), supplier: 'Foshan Cable Factory', leadTimeDays: 7, moq: 1000, landedCostPerUnit: '0.75', totalCost: '1500.00' },
    { platform: 'shopee', productId: 'SKU-SCREEN-E5', shipmentId: 'SHP-005', quantity: 150, status: 'in_transit', expectedArrival: daysFromNow(20), supplier: 'Guangzhou Display Tech', leadTimeDays: 30, moq: 50, landedCostPerUnit: '22.00', totalCost: '3300.00' },
    { platform: 'amazon', productId: 'SKU-WIDGET-A1', shipmentId: 'SHP-006', quantity: 800, status: 'pending', expectedArrival: daysFromNow(25), supplier: 'Shenzhen Electronics Co.', leadTimeDays: 14, moq: 200, landedCostPerUnit: '3.40', totalCost: '2720.00' },
    { platform: 'shopify', productId: 'SKU-CHARGER-C3', shipmentId: 'SHP-007', quantity: 500, status: 'cancelled', expectedArrival: null, supplier: 'Yiwu Power Solutions', leadTimeDays: 10, moq: 500, landedCostPerUnit: '1.80', totalCost: '900.00' },
    { platform: 'amazon', productId: 'SKU-GADGET-B2', shipmentId: 'SHP-008', quantity: 200, status: 'delivered', expectedArrival: daysAgo(15), supplier: 'Dongguan Tech Parts', leadTimeDays: 21, moq: 100, landedCostPerUnit: '8.00', totalCost: '1600.00' },
  ]

  await tdb.insert(schema.inventoryInboundShipments).values(
    shipments.map((s) => ({ tenantId, ...s })),
  )
  console.log(`  → ${shipments.length} shipments inserted`)
}

async function seedAccountHealthEvents(tdb: AppDb) {
  console.log('Seeding account_health_events...')
  const events = [
    { platform: 'amazon', eventType: 'policy_violation', severity: 'critical', title: 'Product listing suspended: SKU-WIDGET-A1', description: 'Listing removed due to restricted product claim in title', affectedEntity: 'SKU-WIDGET-A1', resolvedAt: null, createdAt: hoursAgo(2) },
    { platform: 'amazon', eventType: 'performance_warning', severity: 'warning', title: 'Late shipment rate above threshold', description: 'Late shipment rate reached 5.2% (threshold: 4%)', affectedEntity: 'account', resolvedAt: null, createdAt: hoursAgo(12) },
    { platform: 'shopify', eventType: 'payment_issue', severity: 'warning', title: 'Payment gateway intermittent failures', description: 'Stripe integration showing 3% failure rate in last 24h', affectedEntity: 'payment_gateway', resolvedAt: null, createdAt: hoursAgo(6) },
    { platform: 'tiktok', eventType: 'policy_violation', severity: 'info', title: 'Video content flagged for review', description: 'Product demo video pending TikTok content review', affectedEntity: 'SKU-CABLE-D4', resolvedAt: hoursAgo(1), createdAt: hoursAgo(24) },
    { platform: 'amazon', eventType: 'ip_complaint', severity: 'critical', title: 'IP complaint received: SKU-GADGET-B2', description: 'Trademark holder filed complaint regarding product imagery', affectedEntity: 'SKU-GADGET-B2', resolvedAt: null, createdAt: hoursAgo(48) },
    { platform: 'shopee', eventType: 'performance_warning', severity: 'warning', title: 'Response time SLA breach', description: 'Average customer response time exceeded 24h threshold', affectedEntity: 'customer_service', resolvedAt: hoursAgo(5), createdAt: hoursAgo(72) },
    { platform: 'amazon', eventType: 'listing_suppressed', severity: 'warning', title: 'Missing product information: SKU-SCREEN-E5', description: 'Listing suppressed due to missing weight and dimension data', affectedEntity: 'SKU-SCREEN-E5', resolvedAt: null, createdAt: hoursAgo(96) },
    { platform: 'tiktok', eventType: 'account_review', severity: 'info', title: 'Seller account quarterly review', description: 'Routine quarterly account review — no action needed', affectedEntity: 'account', resolvedAt: hoursAgo(24), createdAt: hoursAgo(168) },
    { platform: 'shopify', eventType: 'ssl_expiry', severity: 'critical', title: 'SSL certificate expiring in 7 days', description: 'Custom domain SSL certificate needs renewal', affectedEntity: 'domain', resolvedAt: hoursAgo(2), createdAt: hoursAgo(48) },
    { platform: 'amazon', eventType: 'account_health', severity: 'info', title: 'Account health score improved', description: 'Account health score rose from 720 to 780 this week', affectedEntity: 'account', resolvedAt: null, createdAt: hoursAgo(4) },
  ]

  await tdb.insert(schema.accountHealthEvents).values(
    events.map((e) => ({ tenantId, ...e })),
  )
  console.log(`  → ${events.length} events inserted`)
}

async function seedServiceCases(tdb: AppDb) {
  console.log('Seeding service_cases...')
  const cases = [
    { platform: 'amazon', caseType: 'refund', orderId: 'ORD-10001', productId: 'SKU-WIDGET-A1', status: 'open', amount: '29.99', customerMessage: 'Product arrived damaged, requesting full refund', agentResponse: null, escalated: false, createdAt: hoursAgo(3) },
    { platform: 'amazon', caseType: 'return', orderId: 'ORD-10002', productId: 'SKU-GADGET-B2', status: 'open', amount: '49.99', customerMessage: 'Wrong color received, want to exchange', agentResponse: 'We apologize. Return label sent to your email.', escalated: false, createdAt: hoursAgo(8) },
    { platform: 'shopify', caseType: 'inquiry', orderId: 'ORD-10003', productId: 'SKU-CHARGER-C3', status: 'resolved', amount: null, customerMessage: 'When will my order ship?', agentResponse: 'Your order ships within 2 business days.', escalated: false, createdAt: hoursAgo(24), resolvedAt: hoursAgo(20) },
    { platform: 'tiktok', caseType: 'refund', orderId: 'ORD-10004', productId: 'SKU-CABLE-D4', status: 'open', amount: '12.99', customerMessage: 'Cable stopped working after 2 days', agentResponse: null, escalated: true, createdAt: hoursAgo(5) },
    { platform: 'shopee', caseType: 'complaint', orderId: 'ORD-10005', productId: 'SKU-SCREEN-E5', status: 'open', amount: '189.99', customerMessage: 'Screen protector has bubbles, very poor quality', agentResponse: 'We are sorry. We will send a replacement immediately.', escalated: false, createdAt: hoursAgo(12) },
    { platform: 'amazon', caseType: 'refund', orderId: 'ORD-10006', productId: 'SKU-WIDGET-A1', status: 'resolved', amount: '29.99', customerMessage: 'Duplicate charge on my account', agentResponse: 'Refund processed successfully.', escalated: false, createdAt: hoursAgo(72), resolvedAt: hoursAgo(48) },
    { platform: 'shopify', caseType: 'return', orderId: 'ORD-10007', productId: 'SKU-CHARGER-C3', status: 'open', amount: '15.99', customerMessage: 'Product not as described', agentResponse: null, escalated: true, createdAt: hoursAgo(2) },
    { platform: 'amazon', caseType: 'inquiry', orderId: null, productId: 'SKU-GADGET-B2', status: 'resolved', amount: null, customerMessage: 'Is this product compatible with iPhone 15?', agentResponse: 'Yes, fully compatible with all iPhone 15 models.', escalated: false, createdAt: hoursAgo(120), resolvedAt: hoursAgo(118) },
    { platform: 'tiktok', caseType: 'complaint', orderId: 'ORD-10008', productId: 'SKU-CABLE-D4', status: 'open', amount: '12.99', customerMessage: 'Delivery took 3 weeks, unacceptable', agentResponse: null, escalated: false, createdAt: hoursAgo(36) },
    { platform: 'shopee', caseType: 'refund', orderId: 'ORD-10009', productId: 'SKU-SCREEN-E5', status: 'resolved', amount: '189.99', customerMessage: 'Never received the package', agentResponse: 'Full refund issued. Courier investigation opened.', escalated: true, createdAt: hoursAgo(168), resolvedAt: hoursAgo(96) },
    { platform: 'amazon', caseType: 'return', orderId: 'ORD-10010', productId: 'SKU-WIDGET-A1', status: 'open', amount: '29.99', customerMessage: 'Changed my mind, want to return', agentResponse: null, escalated: false, createdAt: hoursAgo(1) },
    { platform: 'shopify', caseType: 'inquiry', orderId: 'ORD-10011', productId: 'SKU-CHARGER-C3', status: 'open', amount: null, customerMessage: 'Do you offer bulk discounts?', agentResponse: 'Yes! Orders of 10+ units get 15% off.', escalated: false, createdAt: hoursAgo(4) },
  ]

  await tdb.insert(schema.serviceCases).values(
    cases.map((c) => ({ tenantId, ...c })),
  )
  console.log(`  → ${cases.length} cases inserted`)
}

async function main() {
  console.log(`\nSeeding business data for tenant: ${tenantId}\n`)

  await ensureTenantExists()
  await withTenantDb(tenantId, async (tdb) => {
    const productIds = await ensureCatalogProducts(tdb)
    await seedInventoryLevels(tdb, productIds)
    await seedUnitEconomics(tdb)
    await seedInboundShipments(tdb)
    await seedAccountHealthEvents(tdb)
    await seedServiceCases(tdb)
  })

  console.log('\nDone! Business data seeded successfully.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
