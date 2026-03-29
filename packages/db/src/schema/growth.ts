import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const referralCodes = pgTable('referral_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  code: text('code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const referralRewards = pgTable('referral_rewards', {
  id: uuid('id').defaultRandom().primaryKey(),
  referrerTenantId: uuid('referrer_tenant_id').notNull().references(() => tenants.id),
  newTenantId: uuid('new_tenant_id').notNull().references(() => tenants.id),
  rewardType: text('reward_type').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const npsResponses = pgTable('nps_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  score: integer('score').notNull(),
  feedback: text('feedback'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
