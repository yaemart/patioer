import { describe, it, expect } from 'vitest'
import {
  WALMART_EVENT_TYPES,
  WAYFAIR_B2B_EVENT_TYPES,
  ALL_PLATFORM_EVENT_TYPES,
  SHOPIFY_EVENT_TYPES,
  AMAZON_EVENT_TYPES,
} from './platform-events.js'

describe('platform event type contracts', () => {
  it('Walmart event types follow "walmart:" prefix convention', () => {
    for (const et of WALMART_EVENT_TYPES) {
      expect(et).toMatch(/^walmart:/)
    }
  })

  it('Wayfair B2B event types follow "b2b:wayfair:" prefix convention', () => {
    for (const et of WAYFAIR_B2B_EVENT_TYPES) {
      expect(et).toMatch(/^b2b:wayfair:/)
    }
  })

  it('Walmart includes minimum required event types', () => {
    expect(WALMART_EVENT_TYPES).toContain('walmart:item.updated')
    expect(WALMART_EVENT_TYPES).toContain('walmart:order.created')
    expect(WALMART_EVENT_TYPES).toContain('walmart:inventory.updated')
  })

  it('Wayfair B2B includes PO and inventory events', () => {
    expect(WAYFAIR_B2B_EVENT_TYPES).toContain('b2b:wayfair:po.received')
    expect(WAYFAIR_B2B_EVENT_TYPES).toContain('b2b:wayfair:inventory.updated')
  })

  it('ALL_PLATFORM_EVENT_TYPES is a superset of all per-platform arrays', () => {
    for (const et of SHOPIFY_EVENT_TYPES) {
      expect(ALL_PLATFORM_EVENT_TYPES).toContain(et)
    }
    for (const et of AMAZON_EVENT_TYPES) {
      expect(ALL_PLATFORM_EVENT_TYPES).toContain(et)
    }
    for (const et of WALMART_EVENT_TYPES) {
      expect(ALL_PLATFORM_EVENT_TYPES).toContain(et)
    }
    for (const et of WAYFAIR_B2B_EVENT_TYPES) {
      expect(ALL_PLATFORM_EVENT_TYPES).toContain(et)
    }
  })

  it('no duplicate event types in ALL_PLATFORM_EVENT_TYPES', () => {
    const unique = new Set(ALL_PLATFORM_EVENT_TYPES)
    expect(unique.size).toBe(ALL_PLATFORM_EVENT_TYPES.length)
  })
})
