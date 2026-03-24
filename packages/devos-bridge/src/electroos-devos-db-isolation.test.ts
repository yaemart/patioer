import { describe, expect, it } from 'vitest'
import {
  assertElectroOsAndDevOsDbIsolated,
  isSamePostgresDatabase,
  postgresIdentityFromUrl,
} from './electroos-devos-db-isolation.js'

describe('postgresIdentityFromUrl', () => {
  it('parses host port and database', () => {
    expect(
      postgresIdentityFromUrl('postgres://u:p@localhost:5433/devos'),
    ).toEqual({ hostname: 'localhost', port: '5433', database: 'devos' })
  })

  it('defaults port to 5432', () => {
    expect(postgresIdentityFromUrl('postgres://u:p@h/patioer')).toEqual({
      hostname: 'h',
      port: '5432',
      database: 'patioer',
    })
  })
})

describe('isSamePostgresDatabase', () => {
  it('returns true for identical URLs', () => {
    const u = 'postgres://a:b@localhost:5432/patioer'
    expect(isSamePostgresDatabase(u, u)).toBe(true)
  })

  it('returns false when database name differs', () => {
    expect(
      isSamePostgresDatabase(
        'postgres://a:b@localhost:5432/patioer',
        'postgres://a:b@localhost:5432/devos',
      ),
    ).toBe(false)
  })

  it('returns false when port differs', () => {
    expect(
      isSamePostgresDatabase(
        'postgres://a:b@localhost:5432/patioer',
        'postgres://a:b@localhost:5433/patioer',
      ),
    ).toBe(false)
  })
})

describe('assertElectroOsAndDevOsDbIsolated', () => {
  it('does not throw when databases differ', () => {
    expect(() =>
      assertElectroOsAndDevOsDbIsolated(
        'postgres://u:p@localhost:5432/patioer',
        'postgres://u:p@localhost:5433/devos',
      ),
    ).not.toThrow()
  })

  it('throws when same host port and dbname', () => {
    expect(() =>
      assertElectroOsAndDevOsDbIsolated(
        'postgres://u:p@localhost:5432/patioer',
        'postgres://x:y@localhost:5432/patioer',
      ),
    ).toThrow(/electro_os_and_dev_os_must_use_distinct/)
  })
})
