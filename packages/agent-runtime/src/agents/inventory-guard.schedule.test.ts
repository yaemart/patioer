import { describe, expect, it } from 'vitest'
import { getHourInTimeZone, INVENTORY_GUARD_RECOMMENDED_CRON } from './inventory-guard.schedule.js'

describe('inventory-guard.schedule', () => {
  it('exposes recommended cron for 08:00 (with CRON_TZ)', () => {
    expect(INVENTORY_GUARD_RECOMMENDED_CRON).toBe('0 8 * * *')
  })

  it('getHourInTimeZone returns 08:00 for Shanghai at UTC midnight', () => {
    const d = new Date('2024-06-01T00:00:00.000Z')
    expect(getHourInTimeZone(d, 'Asia/Shanghai')).toBe(8)
  })

  it('getHourInTimeZone returns expected hour in UTC', () => {
    expect(getHourInTimeZone(new Date('2024-06-01T13:00:00.000Z'), 'UTC')).toBe(13)
  })
})
