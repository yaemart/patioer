/**
 * Account health and service operations harness interfaces.
 * Provides read-only access to platform account health, listing issues,
 * Buy Box status, refund cases, and support threads.
 */

export interface HarnessAccountHealthSummary {
  overallStatus: 'healthy' | 'at_risk' | 'critical'
  orderDefectRate: number | null
  lateShipmentRate: number | null
  preFullfillmentCancelRate: number | null
  policyViolations: number
  intellectualPropertyComplaints: number
}

export interface HarnessListingIssue {
  asin: string
  sku: string | null
  issueType: 'suppressed' | 'stranded' | 'pricing_error' | 'image_missing' | 'other'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string
  detectedAt: string
}

export interface BuyBoxEntry {
  asin: string
  sku: string | null
  buyBoxPercentage: number
  isCurrentWinner: boolean
  competitorCount: number
}

export interface RefundCase {
  caseId: string
  orderId: string
  reason: string
  status: 'open' | 'approved' | 'denied' | 'closed'
  amount: number
  currency: string
  createdAt: string
}

export interface SupportThread {
  threadId: string
  subject: string
  status: 'open' | 'pending_response' | 'resolved'
  lastMessageAt: string
  messageCount: number
}

export interface AccountHealthCapableHarness {
  readonly supportsAccountHealth: true
  getAccountHealth(): Promise<HarnessAccountHealthSummary>
  getListingIssues(): Promise<HarnessListingIssue[]>
  getBuyBoxStatus(): Promise<BuyBoxEntry[]>
  getRefundCases(): Promise<RefundCase[]>
  getSupportThreads(): Promise<SupportThread[]>
}
