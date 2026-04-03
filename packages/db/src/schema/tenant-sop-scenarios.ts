import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'
import { sopStatusEnum } from './tenant-sops.js'

export const tenantSopScenarios = pgTable('tenant_sop_scenarios', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  scenarioName: text('scenario_name'),
  scenario: text('scenario').notNull(),
  platform: text('platform'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  status: sopStatusEnum('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  previousVersionId: uuid('previous_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.tenantId, t.scenario, t.platform, t.entityType, t.entityId, t.version),
])
