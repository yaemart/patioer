import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const sopStatusEnum = pgEnum('sop_status', [
  'active',
  'archived',
  'draft',
])

export const tenantSops = pgTable('tenant_sops', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  scope: text('scope').notNull(),
  platform: text('platform'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  scenarioId: uuid('scenario_id'),
  scenario: text('scenario'),
  sopText: text('sop_text').notNull(),
  extractedGoalContext: jsonb('extracted_goal_context'),
  extractedSystemPrompt: text('extracted_system_prompt'),
  extractedGovernance: jsonb('extracted_governance'),
  extractionWarnings: jsonb('extraction_warnings'),
  status: sopStatusEnum('status').notNull().default('active'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  previousVersionId: uuid('previous_version_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.tenantId, t.scope, t.platform, t.entityType, t.entityId, t.version),
])
