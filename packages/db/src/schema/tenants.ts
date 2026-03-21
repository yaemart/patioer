import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').default('starter'),
  paperclipCompanyId: text('paperclip_company_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
