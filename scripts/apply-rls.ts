/**
 * Applies RLS migration SQL that drizzle-kit push cannot handle.
 * Idempotent: uses IF NOT EXISTS / OR REPLACE where possible,
 * and catches "already exists" errors for ALTER TABLE statements.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const sqlPath = resolve(__dirname, '../packages/db/src/migrations/0001_rls.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'))

    for (const stmt of statements) {
      try {
        await client.query(stmt)
      } catch (err: unknown) {
        const pgErr = err as { code?: string; message?: string }
        // 42710 = duplicate_object (policy already exists)
        // 55006 = object_in_use (RLS already enabled)
        if (pgErr.code === '42710' || pgErr.code === '55006') {
          console.log(`[rls] skipped (already applied): ${stmt.slice(0, 60)}...`)
        } else {
          throw err
        }
      }
    }
    console.log('[rls] All RLS policies applied successfully.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[rls] Failed:', err)
  process.exit(1)
})
