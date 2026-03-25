/**
 * Applies scripts/clickhouse/dataos-events.sql to ClickHouse (HTTP API).
 * Usage:
 *   CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=dataos CLICKHOUSE_PASSWORD=dataos \\
 *     pnpm exec tsx scripts/clickhouse-apply-ddl.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@clickhouse/client'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Remove full-line `--` comments so `;` splitting does not drop statements that follow file headers. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
}

async function main(): Promise<void> {
  const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'
  const username = process.env.CLICKHOUSE_USER ?? 'default'
  const password = process.env.CLICKHOUSE_PASSWORD ?? ''
  const sqlPath = join(__dirname, 'clickhouse/dataos-events.sql')
  const sql = stripLineComments(readFileSync(sqlPath, 'utf8'))
  const client = createClient({ url, username, password })
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const stmt of statements) {
    console.log(`[clickhouse-apply-ddl] ${stmt.slice(0, 80)}...`)
    await client.command({ query: `${stmt};` })
  }
  await client.close()
  console.log('[clickhouse-apply-ddl] done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
