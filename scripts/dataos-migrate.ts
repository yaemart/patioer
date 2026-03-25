/**
 * Applies SQL migrations in packages/dataos/migrations/ to the DataOS PostgreSQL database.
 * Usage: DATABASE_URL=postgres://... pnpm exec tsx scripts/dataos-migrate.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '../packages/dataos/migrations')

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: url })
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    console.log(`[dataos-migrate] applying ${file}`)
    await pool.query(sql)
  }
  await pool.end()
  console.log('[dataos-migrate] done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
