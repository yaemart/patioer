import {
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

/** Synced ad campaigns per store platform (Phase 2 · Sprint 4). Aligns with `docs/plans/phase2-plan.md` §4.2. */
export const adsCampaigns = pgTable(
  'ads_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platform: text('platform').notNull(),
    platformCampaignId: text('platform_campaign_id').notNull(),
    name: text('name').notNull(),
    /** `active` | `paused` | `ended` */
    status: text('status').notNull(),
    dailyBudget: numeric('daily_budget', { precision: 10, scale: 2 }),
    totalSpend: numeric('total_spend', { precision: 10, scale: 2 }),
    roas: numeric('roas', { precision: 6, scale: 2 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('ads_campaigns_tenant_platform_campaign_idx').on(
      t.tenantId,
      t.platform,
      t.platformCampaignId,
    ),
  ],
)

export type AdsCampaign = typeof adsCampaigns.$inferSelect
export type NewAdsCampaign = typeof adsCampaigns.$inferInsert
