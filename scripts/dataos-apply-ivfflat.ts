/**
 * Conditionally applies IVFFlat index on decision_memory.context_vector.
 * Requires ≥100 rows to ensure the index has representative data for clustering.
 *
 * Usage: DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos pnpm exec tsx scripts/dataos-apply-ivfflat.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIN_ROWS = 100

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString: url })

  try {
    const { rows: countRows } = await pool.query<{ count: string }>(
      'SELECT count(*) FROM decision_memory',
    )
    const rowCount = Number.parseInt(countRows[0]!.count, 10)

    if (rowCount < MIN_ROWS) {
      console.log(`[ivfflat] skipped: only ${rowCount} rows (need ≥${MIN_ROWS})`)
      return
    }

    console.log(`[ivfflat] ${rowCount} rows found, applying IVFFlat index...`)

    const sqlPath = join(__dirname, 'dataos-pgvector-ivfflat.sql')
    const sql = readFileSync(sqlPath, 'utf8')

    // CREATE INDEX CONCURRENTLY cannot run inside a transaction block
    const client = await pool.connect()
    try {
      await client.query(sql)
    } finally {
      client.release()
    }

    const { rows: indexRows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'decision_memory'
         AND indexname = 'decision_memory_context_vector_ivfflat'`,
    )

    if (indexRows.length > 0) {
      console.log(`[ivfflat] index created successfully: ${indexRows[0]!.indexname}`)
    } else {
      console.error('[ivfflat] index creation failed — not found in pg_indexes')
      process.exit(1)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[ivfflat] error:', err)
  process.exit(1)
})
