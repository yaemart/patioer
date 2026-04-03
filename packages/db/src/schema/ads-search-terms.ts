import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { adsCampaigns } from './ads-campaigns.js'

export const adsSearchTerms = pgTable('ads_search_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => adsCampaigns.id),
  keywordId: uuid('keyword_id'),
  searchTerm: text('search_term').notNull(),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: numeric('spend', { precision: 10, scale: 2 }).default('0'),
  conversions: integer('conversions').default(0),
  reportDate: date('report_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type AdsSearchTerm = typeof adsSearchTerms.$inferSelect
export type NewAdsSearchTerm = typeof adsSearchTerms.$inferInsert
