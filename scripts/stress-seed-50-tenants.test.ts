import { describe, it, expect } from 'vitest'
import { generateTenantId, generateTenantIds } from './stress-seed-50-tenants.js'

describe('stress-seed-50-tenants', () => {
  it('generates deterministic UUIDs', () => {
    const a = generateTenantId(0)
    const b = generateTenantId(0)
    expect(a).toBe(b)
  })

  it('generates unique UUIDs for different indices', () => {
    const ids = generateTenantIds(50)
    const unique = new Set(ids)
    expect(unique.size).toBe(50)
  })

  it('generates valid UUID-shaped strings', () => {
    const id = generateTenantId(7)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('default count is 50', () => {
    const ids = generateTenantIds(50)
    expect(ids).toHaveLength(50)
  })

  it('each tenant ID is 36 characters', () => {
    for (const id of generateTenantIds(10)) {
      expect(id).toHaveLength(36)
    }
  })
})
