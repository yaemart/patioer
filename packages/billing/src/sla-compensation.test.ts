import { describe, expect, it } from 'vitest'
import { calculateSlaCompensation } from './sla-compensation.js'

describe('calculateSlaCompensation', () => {
  describe('uptime-based compensation', () => {
    it('returns 0% when uptime meets SLA (starter 99.5%)', () => {
      const result = calculateSlaCompensation('starter', 99.5, [])
      expect(result.uptimeCompensationPct).toBe(0)
      expect(result.totalCompensationPct).toBe(0)
    })

    it('returns 0% when uptime exceeds SLA', () => {
      const result = calculateSlaCompensation('growth', 99.95, [])
      expect(result.uptimeCompensationPct).toBe(0)
    })

    it('returns 5% per 0.1% below SLA (starter drops to 99.3%)', () => {
      const result = calculateSlaCompensation('starter', 99.3, [])
      expect(result.uptimeCompensationPct).toBe(10)
    })

    it('returns 30% when below 99%', () => {
      const result = calculateSlaCompensation('growth', 98.5, [])
      expect(result.uptimeCompensationPct).toBe(30)
    })

    it('returns 100% when below 95%', () => {
      const result = calculateSlaCompensation('scale', 94.0, [])
      expect(result.uptimeCompensationPct).toBe(100)
    })

    it('handles growth SLA boundary (99.9%)', () => {
      const at = calculateSlaCompensation('growth', 99.9, [])
      expect(at.uptimeCompensationPct).toBe(0)

      const below = calculateSlaCompensation('growth', 99.8, [])
      expect(below.uptimeCompensationPct).toBe(5)
    })

    it('handles scale SLA boundary (99.95%)', () => {
      const at = calculateSlaCompensation('scale', 99.95, [])
      expect(at.uptimeCompensationPct).toBe(0)

      const below = calculateSlaCompensation('scale', 99.85, [])
      expect(below.uptimeCompensationPct).toBe(5)
    })
  })

  describe('incident-based compensation', () => {
    it('adds 20% for DataOS data loss > 1h', () => {
      const result = calculateSlaCompensation('starter', 99.5, [
        { type: 'dataos_data_loss', durationMinutes: 90 },
      ])
      expect(result.incidentCompensationPct).toBe(20)
      expect(result.totalCompensationPct).toBe(20)
    })

    it('no compensation for DataOS data loss <= 1h', () => {
      const result = calculateSlaCompensation('starter', 99.5, [
        { type: 'dataos_data_loss', durationMinutes: 50 },
      ])
      expect(result.incidentCompensationPct).toBe(0)
    })

    it('adds 100% for unapproved agent action', () => {
      const result = calculateSlaCompensation('growth', 99.9, [
        { type: 'agent_unapproved_action' },
      ])
      expect(result.incidentCompensationPct).toBe(100)
      expect(result.totalCompensationPct).toBe(100)
    })
  })

  describe('combined compensation', () => {
    it('caps total at 100%', () => {
      const result = calculateSlaCompensation('starter', 94, [
        { type: 'agent_unapproved_action' },
      ])
      expect(result.uptimeCompensationPct).toBe(100)
      expect(result.incidentCompensationPct).toBe(100)
      expect(result.totalCompensationPct).toBe(100)
    })

    it('combines uptime + incident correctly', () => {
      const result = calculateSlaCompensation('growth', 99.7, [
        { type: 'dataos_data_loss', durationMinutes: 120 },
      ])
      expect(result.uptimeCompensationPct).toBe(10)
      expect(result.incidentCompensationPct).toBe(20)
      expect(result.totalCompensationPct).toBe(30)
    })
  })

  describe('result shape', () => {
    it('includes plan, slaUptime, and actualUptime', () => {
      const result = calculateSlaCompensation('scale', 99.9, [])
      expect(result.plan).toBe('scale')
      expect(result.slaUptime).toBe(99.95)
      expect(result.actualUptime).toBe(99.9)
    })
  })
})
