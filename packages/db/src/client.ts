import * as schema from './schema/index.js'
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production')
}

export const pool = new Pool({
  connectionString: connectionString ?? 'postgres://postgres:postgres@localhost:5432/patioer',
})

export type AppDb = NodePgDatabase<typeof schema>

// Global db — for non-tenant system queries only (e.g. tenant lookup).
// All tenant-scoped data access must use withTenantDb().
export const db: AppDb = drizzle(pool, { schema })

/**
 * Executes callback inside a single PostgreSQL transaction with the tenant
 * context set via SET LOCAL. Every query in the callback is RLS-enforced.
 *
 * Using SET LOCAL (transaction-scoped) on a dedicated PoolClient guarantees
 * the context is never shared with other requests.
 */
export const withTenantDb = async <T>(
  tenantId: string,
  callback: (db: AppDb) => Promise<T>,
): Promise<T> => {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
    const tenantDb: AppDb = drizzle(client, { schema }) as AppDb
    const result = await callback(tenantDb)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
