import {
  boolean,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const goalCategoryEnum = pgEnum('goal_category', [
  'revenue',
  'margin',
  'acos',
  'inventory',
  'customer',
  'custom',
])

export const goalPeriodEnum = pgEnum('goal_period', [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
])

export const tenantGoals = pgTable('tenant_goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  category: goalCategoryEnum('category').notNull(),
  period: goalPeriodEnum('period').notNull().default('monthly'),
  targetValue: numeric('target_value', { precision: 14, scale: 2 }).notNull(),
  currentValue: numeric('current_value', { precision: 14, scale: 2 }).notNull().default('0'),
  unit: text('unit').notNull().default('USD'),
  isActive: boolean('is_active').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
