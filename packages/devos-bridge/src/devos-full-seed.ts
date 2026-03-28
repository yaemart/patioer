/**
 * Phase 4 DevOS 12-Agent 完整种子数据（PDF §01 对齐）
 *
 * 月度总预算：$720
 */
import type { DevOsAgentId } from './devos-org-chart.js'

export type DevOsAgentTrigger =
  | 'on-ticket'
  | 'post-plan'
  | 'on-task'
  | 'pre-deploy'
  | 'api-change'
  | 'post-dev'
  | 'pre-merge'
  | 'post-approve'
  | 'alert'
  | 'always-on'

export interface DevOsAgentSeedEntry {
  id: DevOsAgentId
  name: string
  model: string
  trigger: DevOsAgentTrigger
  monthlyBudgetUsd: number
  slaResolveHours: number
  config: Record<string, unknown>
}

export const DEVOS_FULL_SEED: readonly DevOsAgentSeedEntry[] = [
  {
    id: 'cto-agent',
    name: 'CTO Agent',
    model: 'claude-opus-4-6',
    trigger: 'on-ticket',
    monthlyBudgetUsd: 100,
    slaResolveHours: 72,
    config: { role: 'leadership', canCreateCoordinationTickets: true },
  },
  {
    id: 'pm-agent',
    name: 'PM Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'on-ticket',
    monthlyBudgetUsd: 60,
    slaResolveHours: 72,
    config: { role: 'product', outputFormat: 'prd-markdown' },
  },
  {
    id: 'architect-agent',
    name: 'Architect Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'post-plan',
    monthlyBudgetUsd: 60,
    slaResolveHours: 72,
    config: { role: 'architecture', generateTaskGraph: true },
  },
  {
    id: 'backend-agent',
    name: 'Backend Agent',
    model: 'claude-code',
    trigger: 'on-task',
    monthlyBudgetUsd: 120,
    slaResolveHours: 48,
    config: { role: 'development', language: 'typescript', framework: 'fastify' },
  },
  {
    id: 'frontend-agent',
    name: 'Frontend Agent',
    model: 'claude-code',
    trigger: 'on-task',
    monthlyBudgetUsd: 80,
    slaResolveHours: 48,
    config: { role: 'development', language: 'typescript', framework: 'nextjs' },
  },
  {
    id: 'db-agent',
    name: 'DB Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'pre-deploy',
    monthlyBudgetUsd: 40,
    slaResolveHours: 24,
    config: { role: 'database', autoMigration: true, engine: 'postgresql' },
  },
  {
    id: 'harness-agent',
    name: 'Harness Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'api-change',
    monthlyBudgetUsd: 60,
    slaResolveHours: 48,
    config: { role: 'platform', monitoredApis: ['shopify', 'amazon', 'tiktok', 'shopee'] },
  },
  {
    id: 'qa-agent',
    name: 'QA Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'post-dev',
    monthlyBudgetUsd: 60,
    slaResolveHours: 48,
    config: { role: 'quality', minCoverage: 80, testFramework: 'vitest' },
  },
  {
    id: 'security-agent',
    name: 'Security Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'pre-merge',
    monthlyBudgetUsd: 30,
    slaResolveHours: 24,
    config: { role: 'security', scanTypes: ['dependency', 'sast', 'secrets'] },
  },
  {
    id: 'devops-agent',
    name: 'DevOps Agent',
    model: 'claude-code',
    trigger: 'post-approve',
    monthlyBudgetUsd: 40,
    slaResolveHours: 4,
    config: { role: 'operations', deployTarget: 'staging', requiresHumanApprovalForProd: true },
  },
  {
    id: 'sre-agent',
    name: 'SRE Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'alert',
    monthlyBudgetUsd: 40,
    slaResolveHours: 4,
    config: { role: 'operations', alertSource: 'alertmanager', autoRollback: true },
  },
  {
    id: 'codebase-intel',
    name: 'Codebase Intel',
    model: 'claude-sonnet-4-6',
    trigger: 'always-on',
    monthlyBudgetUsd: 30,
    slaResolveHours: 0,
    config: { role: 'intelligence', indexInterval: '15m', queryCapability: true },
  },
] as const

export const DEVOS_MONTHLY_BUDGET_USD = DEVOS_FULL_SEED.reduce(
  (sum, a) => sum + a.monthlyBudgetUsd, 0,
)

export interface DevOsFullSeedJson {
  schema: string
  version: string
  generatedAt: string
  totalMonthlyBudgetUsd: number
  agents: DevOsAgentSeedEntry[]
}

export function buildDevOsFullSeed(): DevOsFullSeedJson {
  return {
    schema: 'devos-full-seed/v1',
    version: '4.0.0',
    generatedAt: new Date().toISOString(),
    totalMonthlyBudgetUsd: DEVOS_MONTHLY_BUDGET_USD,
    agents: [...DEVOS_FULL_SEED],
  }
}
