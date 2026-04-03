import type { DateRange } from './types.js'
import type { HarnessAdsCampaign } from './ads.types.js'
import type {
  AdKeyword,
  AdMetricsDaily,
  KeywordAdsHarness,
  SearchTermRow,
} from './keyword-ads.types.js'
import type {
  AmazonAdsCredentials,
  AmazonSpCampaignMetrics,
  AmazonSpKeywordResponse,
  AmazonSpSearchTermRow,
} from './amazon-ads.types.js'
import { HarnessError } from './harness-error.js'
import { resilientFetch } from './harness-fetch.js'

const ADS_API_BASE: Record<AmazonAdsCredentials['region'], string> = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
}

const MAX_RETRIES = 4
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 20_000
const USE_FIXTURE = process.env.AMAZON_ADS_API_MODE === 'fixture'

function fixtureKeywords(campaignId: string): AdKeyword[] {
  return [
    { platformKeywordId: 'kw-001', campaignId, keywordText: 'wireless charger', matchType: 'broad', bid: 1.25, status: 'enabled', impressions: 4200, clicks: 180, spend: 225, conversions: 22 },
    { platformKeywordId: 'kw-002', campaignId, keywordText: 'fast charging pad', matchType: 'exact', bid: 2.10, status: 'enabled', impressions: 1800, clicks: 95, spend: 199.5, conversions: 15 },
    { platformKeywordId: 'kw-003', campaignId, keywordText: 'phone charger stand', matchType: 'phrase', bid: 0.85, status: 'paused', impressions: 600, clicks: 20, spend: 17, conversions: 2 },
  ]
}

function fixtureSearchTerms(campaignId: string): SearchTermRow[] {
  return [
    { searchTerm: 'best wireless charger 2026', campaignId, keywordId: 'kw-001', impressions: 1200, clicks: 55, spend: 68.75, conversions: 8, reportDate: '2026-03-25' },
    { searchTerm: 'qi charger for iphone', campaignId, keywordId: 'kw-001', impressions: 900, clicks: 40, spend: 50, conversions: 5, reportDate: '2026-03-25' },
    { searchTerm: 'fast charging pad samsung', campaignId, keywordId: 'kw-002', impressions: 600, clicks: 30, spend: 63, conversions: 4, reportDate: '2026-03-25' },
  ]
}

function fixtureMetrics(campaignId: string): AdMetricsDaily[] {
  const base = new Date('2026-03-20')
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    const spend = 50 + Math.round(Math.random() * 30)
    const sales = spend * (1.5 + Math.random() * 2)
    return {
      campaignId,
      date: d.toISOString().slice(0, 10),
      impressions: 2000 + Math.round(Math.random() * 3000),
      clicks: 80 + Math.round(Math.random() * 120),
      spend,
      sales: Math.round(sales * 100) / 100,
      acos: spend / sales,
      roas: sales / spend,
    }
  })
}

function fixtureCampaigns(): HarnessAdsCampaign[] {
  return [
    { platformCampaignId: 'camp-001', name: 'SP - Wireless Charger', status: 'active', dailyBudget: 50, totalSpend: 1250, roas: 3.2, currency: 'USD' },
    { platformCampaignId: 'camp-002', name: 'SP - Phone Stand', status: 'active', dailyBudget: 30, totalSpend: 680, roas: 2.1, currency: 'USD' },
    { platformCampaignId: 'camp-003', name: 'SP - Clearance', status: 'paused', dailyBudget: 15, totalSpend: 220, roas: 1.4, currency: 'USD' },
  ]
}

export class AmazonAdsHarness implements KeywordAdsHarness {
  readonly supportsAds = true as const
  readonly supportsKeywordAds = true as const

  private accessToken?: string
  private tokenExpiresAt = 0
  private refreshPromise: Promise<void> | null = null

  constructor(private readonly credentials: AmazonAdsCredentials) {}

  private get baseUrl(): string {
    return ADS_API_BASE[this.credentials.region]
  }

  private async refreshAccessToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    })

    const response = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!response.ok) {
      throw new HarnessError('amazon', 'auth_failed', `Amazon Ads token refresh failed: ${response.status}`)
    }

    const token = (await response.json()) as { access_token: string; expires_in: number }
    this.accessToken = token.access_token
    this.tokenExpiresAt = Date.now() + Math.max(token.expires_in * 1000 - 60_000, 1_000)
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => { this.refreshPromise = null })
    }
    await this.refreshPromise
    if (!this.accessToken) throw new HarnessError('amazon', 'auth_failed', 'Empty token after refresh')
    return this.accessToken
  }

  private async adsFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.ensureToken()
    return resilientFetch<T>(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Amazon-Advertising-API-ClientId': this.credentials.clientId,
          'Amazon-Advertising-API-Scope': this.credentials.profileId,
          ...(init?.headers as Record<string, string> | undefined),
        },
      },
      {
        platform: 'amazon',
        bucketKey: `amazon-ads:${this.credentials.profileId}`,
        bucketConfig: { capacity: 10, refillRatePerSecond: 10 },
        maxRetries: MAX_RETRIES,
        baseDelayMs: BASE_DELAY_MS,
        timeoutMs: FETCH_TIMEOUT_MS,
        label: 'Amazon Ads',
      },
      async (res) => (res.status === 204 ? undefined as T : (await res.json()) as T),
    )
  }

  async getAdsCampaigns(): Promise<HarnessAdsCampaign[]> {
    if (USE_FIXTURE) return fixtureCampaigns()
    const rows = await this.adsFetch<Array<{ campaignId: number; name: string; state: string; dailyBudget: number }>>('/v2/sp/campaigns')
    return rows.map((c) => ({
      platformCampaignId: String(c.campaignId),
      name: c.name,
      status: (c.state === 'enabled' ? 'active' : c.state === 'paused' ? 'paused' : 'ended') as HarnessAdsCampaign['status'],
      dailyBudget: c.dailyBudget,
      totalSpend: null,
      roas: null,
      currency: 'USD',
    }))
  }

  async updateAdsBudget(campaignId: string, dailyBudgetUsd: number): Promise<void> {
    if (USE_FIXTURE) return
    await this.adsFetch('/v2/sp/campaigns', {
      method: 'PUT',
      body: JSON.stringify([{ campaignId: Number(campaignId), dailyBudget: dailyBudgetUsd }]),
    })
  }

  async getKeywords(campaignId: string): Promise<AdKeyword[]> {
    if (USE_FIXTURE) return fixtureKeywords(campaignId)
    const rows = await this.adsFetch<AmazonSpKeywordResponse[]>(
      `/v2/sp/keywords?campaignIdFilter=${campaignId}`,
    )
    return rows.map((k) => ({
      platformKeywordId: String(k.keywordId),
      campaignId: String(k.campaignId),
      keywordText: k.keywordText,
      matchType: k.matchType,
      bid: k.bid,
      status: k.state,
    }))
  }

  async updateKeywordBid(keywordId: string, bid: number): Promise<void> {
    if (USE_FIXTURE) return
    await this.adsFetch('/v2/sp/keywords', {
      method: 'PUT',
      body: JSON.stringify([{ keywordId: Number(keywordId), bid }]),
    })
  }

  async addNegativeKeywords(campaignId: string, keywords: string[]): Promise<void> {
    if (USE_FIXTURE) return
    await this.adsFetch('/v2/sp/negativeKeywords', {
      method: 'POST',
      body: JSON.stringify(
        keywords.map((kw) => ({
          campaignId: Number(campaignId),
          keywordText: kw,
          matchType: 'negativeExact',
          state: 'enabled',
        })),
      ),
    })
  }

  async getSearchTermReport(campaignId: string, _range: DateRange): Promise<SearchTermRow[]> {
    if (USE_FIXTURE) return fixtureSearchTerms(campaignId)
    const rows = await this.adsFetch<AmazonSpSearchTermRow[]>(
      `/v2/sp/targets/report?campaignId=${campaignId}`,
    )
    return rows.map((r) => ({
      searchTerm: r.query,
      campaignId: String(r.campaignId),
      keywordId: r.keywordId ? String(r.keywordId) : null,
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.cost,
      conversions: r.attributedConversions7d,
      reportDate: new Date().toISOString().slice(0, 10),
    }))
  }

  async getCampaignMetricsDaily(campaignId: string, _range: DateRange): Promise<AdMetricsDaily[]> {
    if (USE_FIXTURE) return fixtureMetrics(campaignId)
    const rows = await this.adsFetch<AmazonSpCampaignMetrics[]>(
      `/v2/sp/campaigns/report?campaignId=${campaignId}`,
    )
    return rows.map((m) => ({
      campaignId: String(m.campaignId),
      date: m.date,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.cost,
      sales: m.attributedSales7d,
      acos: m.attributedSales7d > 0 ? m.cost / m.attributedSales7d : 0,
      roas: m.cost > 0 ? m.attributedSales7d / m.cost : 0,
    }))
  }
}
