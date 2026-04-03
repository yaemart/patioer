import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const tenantGovernanceSettings = pgTable('tenant_governance_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  priceChangeThreshold: integer('price_change_threshold').notNull().default(15),
  adsBudgetApproval: integer('ads_budget_approval').notNull().default(500),
  newListingApproval: boolean('new_listing_approval').notNull().default(true),
  humanInLoopAgents: jsonb('human_in_loop_agents').notNull().default([]),
  operatingMode: text('operating_mode').notNull().default('daily'),
  approvalMode: text('approval_mode').notNull().default('approval_required'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
