import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const unitEconomicsDaily = pgTable(
  'unit_economics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    platform: text('platform').notNull(),
    productId: text('product_id').notNull(),
    date: date('date').notNull(),
    grossRevenue: numeric('gross_revenue', { precision: 12, scale: 2 }),
    netRevenue: numeric('net_revenue', { precision: 12, scale: 2 }),
    cogs: numeric('cogs', { precision: 12, scale: 2 }),
    platformFee: numeric('platform_fee', { precision: 12, scale: 2 }),
    shippingCost: numeric('shipping_cost', { precision: 12, scale: 2 }),
    adSpend: numeric('ad_spend', { precision: 12, scale: 2 }),
    refundAmount: numeric('refund_amount', { precision: 12, scale: 2 }),
    contributionMargin: numeric('contribution_margin', { precision: 12, scale: 2 }),
    acos: numeric('acos', { precision: 8, scale: 4 }),
    tacos: numeric('tacos', { precision: 8, scale: 4 }),
    unitsSold: integer('units_sold'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('unit_economics_daily_tenant_platform_product_date_idx').on(
      t.tenantId,
      t.platform,
      t.productId,
      t.date,
    ),
  ],
)

export type UnitEconomicsDaily = typeof unitEconomicsDaily.$inferSelect
export type NewUnitEconomicsDaily = typeof unitEconomicsDaily.$inferInsert
