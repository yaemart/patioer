import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubEnv('AMAZON_HEALTH_API_MODE', 'fixture')

const { AmazonHealthHarness } = await import('./amazon-health.harness.js')

describe('AmazonHealthHarness (fixture mode)', () => {
  let harness: InstanceType<typeof AmazonHealthHarness>

  beforeEach(() => {
    harness = new AmazonHealthHarness()
  })

  it('has supportsAccountHealth flag', () => {
    expect(harness.supportsAccountHealth).toBe(true)
  })

  it('getAccountHealth returns fixture summary', async () => {
    const health = await harness.getAccountHealth()
    expect(health.overallStatus).toBe('healthy')
    expect(health).toHaveProperty('orderDefectRate')
    expect(health).toHaveProperty('lateShipmentRate')
    expect(health).toHaveProperty('preFullfillmentCancelRate')
    expect(health).toHaveProperty('policyViolations')
    expect(health).toHaveProperty('intellectualPropertyComplaints')
  })

  it('getListingIssues returns fixture issues array', async () => {
    const issues = await harness.getListingIssues()
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toHaveProperty('asin')
    expect(issues[0]).toHaveProperty('issueType')
    expect(issues[0]).toHaveProperty('severity')
    expect(issues[0]).toHaveProperty('title')
  })

  it('getBuyBoxStatus returns fixture entries', async () => {
    const entries = await harness.getBuyBoxStatus()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]).toHaveProperty('asin')
    expect(entries[0]).toHaveProperty('buyBoxPercentage')
    expect(entries[0]).toHaveProperty('isCurrentWinner')
    expect(entries[0]).toHaveProperty('competitorCount')
  })

  it('getRefundCases returns fixture refunds', async () => {
    const refunds = await harness.getRefundCases()
    expect(refunds.length).toBeGreaterThan(0)
    expect(refunds[0]).toHaveProperty('caseId')
    expect(refunds[0]).toHaveProperty('orderId')
    expect(refunds[0]).toHaveProperty('reason')
    expect(refunds[0]).toHaveProperty('status')
    expect(refunds[0]).toHaveProperty('amount')
  })

  it('getSupportThreads returns fixture threads', async () => {
    const threads = await harness.getSupportThreads()
    expect(threads.length).toBeGreaterThan(0)
    expect(threads[0]).toHaveProperty('threadId')
    expect(threads[0]).toHaveProperty('subject')
    expect(threads[0]).toHaveProperty('status')
    expect(threads[0]).toHaveProperty('messageCount')
  })
})
