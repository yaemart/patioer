import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { adsCampaigns } from './ads-campaigns.js'

export const adsKeywords = pgTable('ads_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => adsCampaigns.id),
  platformKeywordId: text('platform_keyword_id').notNull(),
  keywordText: text('keyword_text').notNull(),
  matchType: text('match_type').notNull().default('broad'),
  bid: numeric('bid', { precision: 10, scale: 4 }),
  status: text('status').notNull().default('enabled'),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: numeric('spend', { precision: 10, scale: 2 }).default('0'),
  conversions: integer('conversions').default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type AdsKeyword = typeof adsKeywords.$inferSelect
export type NewAdsKeyword = typeof adsKeywords.$inferInsert

export const adsNegativeKeywords = pgTable('ads_negative_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => adsCampaigns.id),
  platformKeywordId: text('platform_keyword_id').notNull(),
  keywordText: text('keyword_text').notNull(),
  matchType: text('match_type').notNull().default('exact'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type AdsNegativeKeyword = typeof adsNegativeKeywords.$inferSelect
export type NewAdsNegativeKeyword = typeof adsNegativeKeywords.$inferInsert
