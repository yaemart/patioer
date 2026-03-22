import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)))

describe('RLS migration safety', () => {
  it('uses fail-closed tenant context lookup in all SQL migrations', () => {
    const migrationFiles = readdirSync(migrationsDir).filter(
      (f) => extname(f) === '.sql',
    )

    expect(migrationFiles.length).toBeGreaterThan(0)

    for (const fileName of migrationFiles) {
      const sql = readFileSync(join(migrationsDir, fileName), 'utf8')
      expect(sql).not.toContain("current_setting('app.tenant_id', true)")
    }
  })

  it('keeps RLS tenant policies bound to app.tenant_id', () => {
    const sql = readFileSync(join(migrationsDir, '0001_rls.sql'), 'utf8')
    expect(sql).toContain("current_setting('app.tenant_id')::uuid")
  })

  it('enables RLS and creates isolation policies for business tables', () => {
    const sql = readFileSync(join(migrationsDir, '0001_rls.sql'), 'utf8')

    // These tables hold tenant business data and must be RLS-protected.
    const businessTables = [
      'platform_credentials',
      'products',
      'orders',
      'agents',
      'agent_events',
      'approvals',
      'webhook_events',
    ]

    for (const tableName of businessTables) {
      expect(sql).toContain(
        `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
      )
      expect(sql).toContain(
        `ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;`,
      )
      expect(sql).toContain(
        `CREATE POLICY tenant_isolation_${tableName} ON ${tableName}`,
      )
    }

    // No IF EXISTS — RLS setup must fail fast if a table is missing.
    expect(sql).not.toContain('ALTER TABLE IF EXISTS')
  })

  it('does not apply per-row RLS to the tenants table', () => {
    const sql = readFileSync(join(migrationsDir, '0001_rls.sql'), 'utf8')

    // tenants is queried before a tenant context is established (slug lookup).
    // Applying id = current_setting(...)::uuid would make ALL tenant lookups
    // fail with a missing-setting error, breaking the entire application.
    expect(sql).not.toContain('ALTER TABLE tenants ENABLE ROW LEVEL SECURITY')
    expect(sql).not.toContain('ON tenants')
  })
})
