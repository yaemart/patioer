import { describe, expect, it } from 'vitest'
import { DEVOS_BRIDGE_VERSION } from './version.js'

describe('DEVOS_BRIDGE_VERSION', () => {
  it('exports non-empty semver-like string', () => {
    expect(DEVOS_BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(DEVOS_BRIDGE_VERSION.length).toBeGreaterThan(0)
  })
})
