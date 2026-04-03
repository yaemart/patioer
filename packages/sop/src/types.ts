export interface SopRecord {
  id: string
  tenantId: string
  scope: string
  platform: string | null
  entityType: string | null
  entityId: string | null
  scenarioId: string | null
  scenario: string | null
  sopText: string
  extractedGoalContext: Record<string, unknown> | null
  extractedSystemPrompt: string | null
  extractedGovernance: Record<string, unknown> | null
  extractionWarnings: unknown[] | null
  status: 'active' | 'archived' | 'draft'
  effectiveFrom: Date | null
  effectiveTo: Date | null
  previousVersionId: string | null
  version: number
  createdAt: Date | null
  updatedAt: Date | null
}

export interface ResolvedSop {
  sop: SopRecord
  resolvedAt: Date
  resolutionPath: string
}

export interface SopResolutionContext {
  agentScope: string
  tenantId: string
  platform?: string
  entityType?: string
  entityId?: string
  now?: Date
}
