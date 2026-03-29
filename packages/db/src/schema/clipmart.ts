import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const clipmartTemplates = pgTable('clipmart_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorTenantId: uuid('author_tenant_id').references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  targetMarkets: text('target_markets').array().notNull().default([]),
  targetCategories: text('target_categories').array().notNull().default([]),
  platforms: text('platforms').array().notNull().default([]),
  config: jsonb('config').notNull().default({}),
  performance: jsonb('performance').notNull().default({}),
  downloads: integer('downloads').notNull().default(0),
  rating: numeric('rating', { precision: 3, scale: 2 }),
  isOfficial: boolean('is_official').notNull().default(false),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const templateReviews = pgTable('template_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').notNull().references(() => clipmartTemplates.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  gmvChange: numeric('gmv_change', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})
