import type {
  AccountHealthCapableHarness,
  HarnessAccountHealthSummary,
  BuyBoxEntry,
  HarnessListingIssue,
  RefundCase,
  SupportThread,
} from './account-health.types.js'
import { HarnessError } from './harness-error.js'
import { resilientFetch } from './harness-fetch.js'

export interface AmazonHealthCredentials {
  sellerId: string
  mwsAuthToken: string
  region: 'na' | 'eu' | 'fe'
}

const HEALTH_API_BASE: Record<AmazonHealthCredentials['region'], string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 15_000
const USE_FIXTURE = process.env.AMAZON_HEALTH_API_MODE !== 'live'

function fixtureHealth(): HarnessAccountHealthSummary {
  return {
    overallStatus: 'healthy',
    orderDefectRate: 0.3,
    lateShipmentRate: 1.2,
    preFullfillmentCancelRate: 0.5,
    policyViolations: 0,
    intellectualPropertyComplaints: 0,
  }
}

function fixtureListingIssues(): HarnessListingIssue[] {
  return [
    { asin: 'B0TEST001', sku: 'WC-001', issueType: 'suppressed', severity: 'warning', title: 'Main image missing white background', description: 'Main product image does not meet white background requirement', detectedAt: '2026-03-28T10:00:00Z' },
    { asin: 'B0TEST002', sku: 'WC-002', issueType: 'pricing_error', severity: 'critical', title: 'Price exceeds competitive range', description: 'Your price is significantly higher than similar offers', detectedAt: '2026-03-29T08:00:00Z' },
  ]
}

function fixtureBuyBox(): BuyBoxEntry[] {
  return [
    { asin: 'B0TEST001', sku: 'WC-001', buyBoxPercentage: 78, isCurrentWinner: true, competitorCount: 3 },
    { asin: 'B0TEST002', sku: 'WC-002', buyBoxPercentage: 45, isCurrentWinner: false, competitorCount: 5 },
    { asin: 'B0TEST003', sku: 'WC-003', buyBoxPercentage: 92, isCurrentWinner: true, competitorCount: 2 },
  ]
}

function fixtureRefunds(): RefundCase[] {
  return [
    { caseId: 'ref-001', orderId: 'ord-101', reason: 'Item not as described', status: 'open', amount: 29.99, currency: 'USD', createdAt: '2026-03-27T14:00:00Z' },
    { caseId: 'ref-002', orderId: 'ord-102', reason: 'Defective item', status: 'approved', amount: 15.50, currency: 'USD', createdAt: '2026-03-25T09:00:00Z' },
  ]
}

function fixtureThreads(): SupportThread[] {
  return [
    { threadId: 'thr-001', subject: 'Where is my order?', status: 'open', lastMessageAt: '2026-03-29T16:00:00Z', messageCount: 3 },
    { threadId: 'thr-002', subject: 'Request for invoice', status: 'pending_response', lastMessageAt: '2026-03-28T11:00:00Z', messageCount: 1 },
  ]
}

export class AmazonHealthHarness implements AccountHealthCapableHarness {
  readonly supportsAccountHealth = true as const

  constructor(private readonly credentials?: AmazonHealthCredentials) {}

  async getAccountHealth(): Promise<HarnessAccountHealthSummary> {
    if (USE_FIXTURE) return fixtureHealth()
    return this.healthFetch<HarnessAccountHealthSummary>('/notifications/v1/accountHealth')
  }

  async getListingIssues(): Promise<HarnessListingIssue[]> {
    if (USE_FIXTURE) return fixtureListingIssues()
    return this.healthFetch<HarnessListingIssue[]>('/listings/v1/issues')
  }

  async getBuyBoxStatus(): Promise<BuyBoxEntry[]> {
    if (USE_FIXTURE) return fixtureBuyBox()
    return this.healthFetch<BuyBoxEntry[]>('/catalog/v1/buyBox')
  }

  async getRefundCases(): Promise<RefundCase[]> {
    if (USE_FIXTURE) return fixtureRefunds()
    return this.healthFetch<RefundCase[]>('/messaging/v1/refunds')
  }

  async getSupportThreads(): Promise<SupportThread[]> {
    if (USE_FIXTURE) return fixtureThreads()
    return this.healthFetch<SupportThread[]>('/messaging/v1/threads')
  }

  private get baseUrl(): string {
    return HEALTH_API_BASE[this.ensureCredentials().region]
  }

  private ensureCredentials(): AmazonHealthCredentials {
    if (!this.credentials) {
      throw new HarnessError('amazon', 'auth_failed', 'AmazonHealthHarness: credentials required for live mode')
    }
    return this.credentials
  }

  private async healthFetch<T>(path: string): Promise<T> {
    const creds = this.ensureCredentials()
    return resilientFetch<T>(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-amz-access-token': creds.mwsAuthToken,
        },
      },
      {
        platform: 'amazon',
        bucketKey: `amazon-health:${creds.sellerId}`,
        bucketConfig: { capacity: 5, refillRatePerSecond: 5 },
        maxRetries: MAX_RETRIES,
        baseDelayMs: BASE_DELAY_MS,
        timeoutMs: FETCH_TIMEOUT_MS,
        label: 'Amazon Health',
      },
    )
  }
}
