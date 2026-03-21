import 'fastify'
import type { AppDb } from '@patioer/db'

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string
    /**
     * Executes `callback` inside a PostgreSQL transaction where
     * `SET LOCAL app.tenant_id` has already been issued, ensuring
     * all queries are filtered by RLS policies.
     *
     * `null` when the request carries no valid `x-tenant-id` header.
     */
    withDb: (<T>(callback: (db: AppDb) => Promise<T>) => Promise<T>) | null
  }
}
