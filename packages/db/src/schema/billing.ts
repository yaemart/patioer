import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const billingUsageLogs = pgTable('billing_usage_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  agentId: text('agent_id').notNull(),
  tokensUsed: integer('tokens_used').notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull(),
  model: text('model').notNull(),
  isOverage: boolean('is_overage').notNull().default(false),
  reportedToStripe: boolean('reported_to_stripe').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const billingReconciliation = pgTable('billing_reconciliation', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  stripeAmountCents: integer('stripe_amount_cents').notNull(),
  calculatedAmountCents: integer('calculated_amount_cents').notNull(),
  diffCents: integer('diff_cents').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
