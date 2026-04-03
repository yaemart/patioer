/**
 * Amazon Advertising API v3 (Sponsored Products) response types.
 * Used internally by AmazonAdsHarness — callers consume the normalized
 * KeywordAdsHarness types instead.
 */

export interface AmazonAdsCredentials {
  profileId: string
  clientId: string
  clientSecret: string
  refreshToken: string
  region: 'na' | 'eu' | 'fe'
}

export interface AmazonSpKeywordResponse {
  keywordId: number
  campaignId: number
  adGroupId: number
  state: 'enabled' | 'paused' | 'archived'
  keywordText: string
  matchType: 'broad' | 'phrase' | 'exact'
  bid: number
}

export interface AmazonSpNegativeKeywordResponse {
  keywordId: number
  campaignId: number
  adGroupId: number
  keywordText: string
  matchType: 'negativePhrase' | 'negativeExact'
}

export interface AmazonSpSearchTermRow {
  query: string
  campaignId: number
  keywordId: number
  impressions: number
  clicks: number
  cost: number
  attributedConversions7d: number
}

export interface AmazonSpCampaignMetrics {
  campaignId: number
  date: string
  impressions: number
  clicks: number
  cost: number
  attributedSales7d: number
}
