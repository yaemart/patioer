import type {
  AccountHealthPort,
  InventoryPlanningPort,
  ServiceOpsPort,
  TenantHarness,
  UnitEconomicsPort,
} from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import type { DataOsPort } from './dataos-types.js'

export interface LlmParams {
  prompt: string
  systemPrompt?: string
}

export interface LlmResponse {
  text: string
}

export interface ApprovalRequest {
  action: string
  payload: unknown
  reason: string
}

export interface TicketParams {
  title: string
  body: string
}

export interface HarnessPort {
  getHarness(tenantId: string, agentId: string, platform?: string): TenantHarness
  getEnabledPlatforms(tenantId: string, agentId: string): string[]
}

export interface BudgetPort {
  isExceeded(tenantId: string, agentId: string): Promise<boolean>
}

export interface AuditPort {
  logAction(
    tenantId: string,
    agentId: string,
    action: string,
    payload: unknown,
  ): Promise<void>
}

export interface ApprovalPort {
  requestApproval(
    tenantId: string,
    agentId: string,
    params: ApprovalRequest,
  ): Promise<void>
}

export interface TicketPort {
  createTicket(tenantId: string, agentId: string, params: TicketParams): Promise<void>
}

export interface PendingApprovalItem {
  id: string
  action: string
  payload: unknown
  createdAt: Date | string | null
}

export interface ApprovalsQueryPort {
  listPending(tenantId: string, agentId: string): Promise<PendingApprovalItem[]>
}

export interface RecentAgentEvent {
  id: string
  action: string
  payload: unknown
  createdAt: Date | string | null
}

export interface EventsPort {
  getRecent(tenantId: string, agentId: string, limit: number): Promise<RecentAgentEvent[]>
}

export interface LlmPort {
  complete(
    params: LlmParams,
    context: { tenantId: string; agentId: string },
  ): Promise<LlmResponse>
}

export type ApprovalMode = 'approval_required' | 'approval_informed'

export const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['approval_required', 'approval_informed']

export interface GovernanceSettings {
  priceChangeThreshold: number
  adsBudgetApproval: number
  newListingApproval: boolean
  humanInLoopAgents: string[]
  approvalMode: ApprovalMode
}

const GOVERNANCE_RANGES: Record<string, { min: number; max: number }> = {
  priceChangeThreshold: { min: 5, max: 30 },
  adsBudgetApproval: { min: 100, max: 2000 },
}

export function mergeGovernanceWithSop(
  base: GovernanceSettings,
  sopGov: Record<string, unknown> | null,
): GovernanceSettings {
  if (!sopGov || Object.keys(sopGov).length === 0) return base

  const merged = { ...base }

  if (typeof sopGov.priceChangeThreshold === 'number') {
    const { min, max } = GOVERNANCE_RANGES.priceChangeThreshold
    merged.priceChangeThreshold = Math.min(max, Math.max(min, sopGov.priceChangeThreshold))
  }
  if (typeof sopGov.adsBudgetApproval === 'number') {
    const { min, max } = GOVERNANCE_RANGES.adsBudgetApproval
    merged.adsBudgetApproval = Math.min(max, Math.max(min, sopGov.adsBudgetApproval))
  }
  if (typeof sopGov.newListingApproval === 'boolean') {
    merged.newListingApproval = sopGov.newListingApproval
  }

  return merged
}

export const DEFAULT_GOVERNANCE_SETTINGS: GovernanceSettings = {
  priceChangeThreshold: 15,
  adsBudgetApproval: 500,
  newListingApproval: true,
  humanInLoopAgents: [],
  approvalMode: 'approval_required',
}

export interface GovernancePort {
  getSettings(tenantId: string): Promise<GovernanceSettings>
}

export interface SopRecord {
  id: string
  scope: string
  platform: string | null
  entityType: string | null
  entityId: string | null
  status: 'active' | 'archived' | 'draft'
  effectiveFrom: Date | null
  effectiveTo: Date | null
  version: number
  extractedGoalContext: Record<string, unknown> | null
  extractedSystemPrompt: string | null
  extractedGovernance: Record<string, unknown> | null
}

export interface SopPort {
  getActiveSops(tenantId: string): Promise<SopRecord[]>
}

export interface AgentContextOptions {
  tenantId: string
  agentId: string
  agentType?: string
}

export interface CreateAgentContextDeps {
  harness: HarnessPort
  budget: BudgetPort
  audit: AuditPort
  approvals: ApprovalPort
  tickets: TicketPort
  llm: LlmPort
  market?: MarketContext
  approvalsQuery?: ApprovalsQueryPort
  events?: EventsPort
  dataOS?: DataOsPort
  governance?: GovernancePort
  unitEconomics?: UnitEconomicsPort
  inventoryPlanning?: InventoryPlanningPort
  accountHealth?: AccountHealthPort
  serviceOps?: ServiceOpsPort
  sop?: SopPort
}
