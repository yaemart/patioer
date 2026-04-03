import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubEnv('AMAZON_ADS_API_MODE', 'fixture')

const { AmazonAdsHarness } = await import('./amazon-ads.harness.js')

const creds = {
  profileId: 'test-profile',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  refreshToken: 'test-refresh',
  region: 'na' as const,
}

describe('AmazonAdsHarness (fixture mode)', () => {
  let harness: InstanceType<typeof AmazonAdsHarness>

  beforeEach(() => {
    harness = new AmazonAdsHarness(creds)
  })

  it('has supportsAds and supportsKeywordAds flags', () => {
    expect(harness.supportsAds).toBe(true)
    expect(harness.supportsKeywordAds).toBe(true)
  })

  it('getAdsCampaigns returns fixture campaigns', async () => {
    const campaigns = await harness.getAdsCampaigns()
    expect(campaigns.length).toBeGreaterThan(0)
    expect(campaigns[0]).toHaveProperty('platformCampaignId')
    expect(campaigns[0]).toHaveProperty('name')
    expect(campaigns[0]).toHaveProperty('status')
  })

  it('getKeywords returns fixture keywords for a campaign', async () => {
    const keywords = await harness.getKeywords('camp-001')
    expect(keywords.length).toBe(3)
    expect(keywords[0]).toHaveProperty('keywordText')
    expect(keywords[0]).toHaveProperty('matchType')
    expect(keywords[0]).toHaveProperty('bid')
  })

  it('getSearchTermReport returns fixture search terms', async () => {
    const range = { from: new Date('2026-03-20'), to: new Date('2026-03-27') }
    const terms = await harness.getSearchTermReport('camp-001', range)
    expect(terms.length).toBeGreaterThan(0)
    expect(terms[0]).toHaveProperty('searchTerm')
    expect(terms[0]).toHaveProperty('impressions')
  })

  it('getCampaignMetricsDaily returns 7 days of fixture metrics', async () => {
    const range = { from: new Date('2026-03-20'), to: new Date('2026-03-27') }
    const metrics = await harness.getCampaignMetricsDaily('camp-001', range)
    expect(metrics.length).toBe(7)
    expect(metrics[0]).toHaveProperty('spend')
    expect(metrics[0]).toHaveProperty('roas')
  })

  it('updateKeywordBid is a no-op in fixture mode', async () => {
    await expect(harness.updateKeywordBid('kw-001', 2.5)).resolves.toBeUndefined()
  })

  it('addNegativeKeywords is a no-op in fixture mode', async () => {
    await expect(harness.addNegativeKeywords('camp-001', ['bad keyword'])).resolves.toBeUndefined()
  })

  it('updateAdsBudget is a no-op in fixture mode', async () => {
    await expect(harness.updateAdsBudget('camp-001', 100)).resolves.toBeUndefined()
  })
})
