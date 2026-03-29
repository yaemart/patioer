export interface CustomerSuccessRunInput {
  tenantIds?: string[]
}

export interface TenantHealthDimension {
  dimension: 'heartbeat_rate' | 'login_frequency' | 'approval_response' | 'gmv_trend'
  rawValue: number
  score: number
  weight: number
}

export interface TenantHealthResult {
  tenantId: string
  score: number
  dimensions: TenantHealthDimension[]
  action: 'none' | 'intervention' | 'upsell_suggestion' | 'review_invitation'
}

export interface CustomerSuccessResult {
  runId: string
  tenantsScanned: number
  results: TenantHealthResult[]
  interventionsSent: number
  upsellsSuggested: number
}

export const CS_AGENT_HEARTBEAT_MS = 24 * 60 * 60 * 1000
