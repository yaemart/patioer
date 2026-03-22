import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

// accessToken is stored AES-256 encrypted at the application layer.
export const platformCredentials = pgTable(
  'platform_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platform: text('platform').notNull(),
    credentialType: text('credential_type').notNull().default('oauth'),
    shopDomain: text('shop_domain'),
    accessToken: text('access_token').notNull(),
    scopes: text('scopes').array(),
    region: text('region').notNull().default('global'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('platform_credentials_tenant_platform_idx').on(
      t.tenantId,
      t.platform,
      t.region,
    ),
  ],
)
