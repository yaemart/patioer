import {
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const sopScenarioTemplates = pgTable('sop_scenario_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  scenario: text('scenario').notNull(),
  scope: text('scope').notNull(),
  platform: text('platform'),
  defaultSopText: text('default_sop_text').notNull(),
  defaultGoalContext: jsonb('default_goal_context').notNull(),
  editableFields: jsonb('editable_fields').notNull(),
  lockedFields: jsonb('locked_fields').notNull(),
}, (t) => [
  unique().on(t.scenario, t.scope, t.platform),
])
