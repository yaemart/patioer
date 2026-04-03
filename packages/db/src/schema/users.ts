import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  role: text('role').notNull().default('owner'),
  plan: text('plan').notNull().default('starter'),
  company: text('company').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
