import {
  date,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { adsCampaigns } from './ads-campaigns.js'

export const adsMetricsDaily = pgTable('ads_metrics_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => adsCampaigns.id),
  date: date('date').notNull(),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: numeric('spend', { precision: 10, scale: 2 }).default('0'),
  sales: numeric('sales', { precision: 10, scale: 2 }).default('0'),
  acos: numeric('acos', { precision: 6, scale: 4 }),
  roas: numeric('roas', { precision: 6, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type AdsMetricDaily = typeof adsMetricsDaily.$inferSelect
export type NewAdsMetricDaily = typeof adsMetricsDaily.$inferInsert
