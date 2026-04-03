import type { DateRange } from './types.js'
import type { AdsCapableHarness } from './ads.types.js'

export interface AdKeyword {
  platformKeywordId: string
  campaignId: string
  keywordText: string
  matchType: 'broad' | 'phrase' | 'exact'
  bid: number
  status: 'enabled' | 'paused' | 'archived'
  impressions?: number
  clicks?: number
  spend?: number
  conversions?: number
}

export interface SearchTermRow {
  searchTerm: string
  campaignId: string
  keywordId: string | null
  impressions: number
  clicks: number
  spend: number
  conversions: number
  reportDate: string
}

export interface AdMetricsDaily {
  campaignId: string
  date: string
  impressions: number
  clicks: number
  spend: number
  sales: number
  acos: number
  roas: number
}

/**
 * Extended ads harness for platforms with keyword-level advertising (e.g. Amazon SP).
 * Agents use this to manage search-term-based campaigns at granular keyword level.
 */
export interface KeywordAdsHarness extends AdsCapableHarness {
  readonly supportsKeywordAds: true
  getKeywords(campaignId: string): Promise<AdKeyword[]>
  updateKeywordBid(keywordId: string, bid: number): Promise<void>
  addNegativeKeywords(campaignId: string, keywords: string[]): Promise<void>
  getSearchTermReport(campaignId: string, range: DateRange): Promise<SearchTermRow[]>
  getCampaignMetricsDaily(campaignId: string, range: DateRange): Promise<AdMetricsDaily[]>
}
