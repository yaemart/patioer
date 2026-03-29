import { boolean, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const onboardingProgress = pgTable('onboarding_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  currentStep: integer('current_step').notNull().default(1),
  stepData: jsonb('step_data').notNull().default({}),
  oauthStatus: jsonb('oauth_status').notNull().default({}),
  healthCheckPassed: boolean('health_check_passed').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})
