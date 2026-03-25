import pg from 'pg'

type ParsedDb = {
  user: string
  password: string
  database: string
}

/** Double-quote a PostgreSQL identifier (roles, databases in GRANT, etc.). */
function pgQuoteIdent(ident: string): string {
  if (!ident) throw new Error('identifier must be non-empty')
  return `"${ident.replace(/"/g, '""')}"`
}

/** Single-quote a PostgreSQL string literal (e.g. passwords, rolname comparisons). */
function pgQuoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function parseTarget(url: string): ParsedDb {
  const u = new URL(url)
  const user = decodeURIComponent(u.username || '')
  const password = decodeURIComponent(u.password || '')
  const database = u.pathname.replace(/^\//, '')
  if (!user || !database) {
    throw new Error('TEST_DATABASE_URL must include user and database')
  }
  return { user, password, database }
}

async function main() {
  const adminUrl = process.env.DATABASE_URL
  const targetUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) throw new Error('DATABASE_URL (admin) is required')
  if (!targetUrl) throw new Error('TEST_DATABASE_URL is required')

  const target = parseTarget(targetUrl)
  const client = new pg.Client({ connectionString: adminUrl })
  await client.connect()

  const identUser = pgQuoteIdent(target.user)
  const identDb = pgQuoteIdent(target.database)
  const litUser = pgQuoteLiteral(target.user)
  const litPassword = pgQuoteLiteral(target.password)

  try {
    const roleSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${litUser}) THEN
    CREATE ROLE ${identUser} LOGIN PASSWORD ${litPassword};
  END IF;
END $$;`
    await client.query(roleSql)
    await client.query(
      `ALTER ROLE ${identUser} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    )
    await client.query(`GRANT CONNECT ON DATABASE ${identDb} TO ${identUser}`)
    await client.query(`GRANT USAGE ON SCHEMA public TO ${identUser}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identUser}`)
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${identUser}`)
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identUser}`,
    )
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${identUser}`,
    )
    console.log(`[db-role] ready: ${target.user} on ${target.database}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[db-role] Failed:', err)
  process.exit(1)
})
