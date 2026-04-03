import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { agents } from './agents.js'
import { tenants } from './tenants.js'

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
])

export const approvals = pgTable('approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  action: text('action').notNull(),
  payload: jsonb('payload'),
  status: approvalStatusEnum('status').notNull().default('pending'),
  displayTitle: text('display_title'),
  displayDescription: text('display_description'),
  impactPreview: jsonb('impact_preview'),
  rollbackPlan: text('rollback_plan'),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
