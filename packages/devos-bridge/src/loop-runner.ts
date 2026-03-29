/**
 * LoopRunner — Sprint 9 E2E 演练入口（Phase 4 §S9 任务 9.1–9.5）
 *
 * 组装确定性 Port Adapter → 执行 AutonomousDevLoop → 收集证据。
 * 支持失败注入（用于 AC-P4-05 回滚验证、AC-P4-03 安全问题验证）。
 */

import type { DevOsTicket } from './ticket-protocol.js'
import type { LoopRunSummary, LoopStage, EventSink } from './loop-context.js'
import type { LoopAgentPorts, CodeResult, QaResult, SecurityResult, SreResult } from './autonomous-loop.js'
import type { TaskGraph } from './task-graph.js'
import { AutonomousDevLoop } from './autonomous-loop.js'

// ─── Rehearsal Ticket ─────────────────────────────────────────────────────────

export const REHEARSAL_TICKET: DevOsTicket = {
  type: 'feature',
  priority: 'P2',
  title: 'Price Sentinel 品类阈值 — 不同品类使用不同变价阈值',
  description: [
    '当前 Price Sentinel 使用全局 15% 阈值判断是否触发人工审批。',
    '需求：每个商品品类可配置独立阈值（如电子产品 10%，服装 20%，食品 5%）。',
    '影响范围：需新增 DB migration（price_rules 表新增 category_threshold_pct 列）',
    '+ 修改 Price Sentinel agent 逻辑 + 更新 DataOS Feature Store schema + 测试覆盖。',
  ].join('\n'),
  context: { agentId: 'price-sentinel' },
  sla: { acknowledge: '24h', resolve: '72h' },
}

export const SECURITY_TEST_TICKET: DevOsTicket = {
  type: 'bug',
  priority: 'P1',
  title: 'Security: Remove hardcoded API key in price-sentinel config',
  description: [
    'Security scan detected a hardcoded Shopify API key in price-sentinel configuration.',
    'Must extract to environment variable and rotate the exposed key.',
  ].join('\n'),
  context: { agentId: 'security-agent' },
  sla: { acknowledge: '4h', resolve: '24h' },
}

// ─── Evidence Types ───────────────────────────────────────────────────────────

export interface LoopRunEvidence {
  summary: LoopRunSummary
  generatedFiles: string[]
  fileContents: Record<string, string>
  followUpTickets: Array<{ type: string; priority: string; title: string }>
  securityFindings: Array<{ severity: string; description: string }>
  approvalRequests: Array<{ runId: string; ticketId: string; summary: string }>
  events: Array<{ eventType: string; stage: number; payload: unknown }>
}

// ─── Failure Injection ────────────────────────────────────────────────────────

export interface FailureInjection {
  stage: LoopStage
  error: string
}

export interface SecurityInjection {
  insertSecret: boolean
  fixOnRetry: boolean
}

// ─── Runner Options ───────────────────────────────────────────────────────────

export interface LoopRunnerOptions {
  tenantId: string
  failureInjection?: FailureInjection
  securityInjection?: SecurityInjection
}

// ─── Evidence-collecting EventSink ─────────────────────────────────────────────

function createEvidenceEventSink(events: LoopRunEvidence['events']): EventSink {
  return {
    async insertEvent(event) {
      const payload = event.payload as Record<string, unknown> | undefined
      events.push({
        eventType: event.eventType,
        stage: (payload?.stage as number) ?? 0,
        payload: event.payload,
      })
    },
  }
}

// ─── LoopRunner ───────────────────────────────────────────────────────────────

export class LoopRunner {
  private readonly options: LoopRunnerOptions

  constructor(options: LoopRunnerOptions) {
    this.options = options
  }

  async execute(ticket: DevOsTicket, runId: string): Promise<LoopRunEvidence> {
    const evidence: LoopRunEvidence = {
      summary: undefined!,
      generatedFiles: [],
      fileContents: {},
      followUpTickets: [],
      securityFindings: [],
      approvalRequests: [],
      events: [],
    }

    const eventSink = createEvidenceEventSink(evidence.events)
    const ports = this.buildPorts(evidence, ticket)

    const loop = new AutonomousDevLoop(
      {
        tenantId: this.options.tenantId,
        sreDurationMs: 50,
        maxCodeReviewRetries: this.options.securityInjection?.fixOnRetry ? 3 : 2,
      },
      { ...ports, eventSink },
    )

    evidence.summary = await loop.run(ticket, runId)
    return evidence
  }

  private buildPorts(evidence: LoopRunEvidence, _ticket: DevOsTicket): LoopAgentPorts {
    const { failureInjection, securityInjection } = this.options
    let securityAttempt = 0

    return {
      pm: {
        async analyze(t) {
          const hasMigration = t.description.toLowerCase().includes('migration')
          const moduleCount = (t.description.match(/修改|更新|影响/g) ?? []).length
          return {
            summary: `${t.title} — ${t.description.split('\n')[0]}`,
            acceptanceCriteria: [
              '品类阈值可独立配置',
              '现有全局 15% 阈值作为默认值保留',
              '测试覆盖率 ≥80%',
              '向后兼容：无品类配置时使用全局阈值',
            ],
            estimatedComplexity: hasMigration && moduleCount >= 2 ? 'high' : moduleCount >= 1 ? 'medium' : 'low',
          }
        },
      },

      architect: {
        async design(analysis, t) {
          const requiresMigration = t.description.toLowerCase().includes('migration')
            || t.description.toLowerCase().includes('column')
            || t.description.toLowerCase().includes('表')
          const modules = extractModules(t.description)
          return {
            approach: [
              '1. 新增 price_rules.category_threshold_pct 列（DB migration）',
              '2. Price Sentinel 查询时按品类匹配阈值，无匹配则 fallback 15%',
              '3. DataOS Feature Store upsert 时携带品类信息',
              '4. 全量单元测试 + 集成测试覆盖',
            ].join('\n'),
            affectedModules: modules.length > 0 ? modules : ['price-sentinel', 'dataos'],
            requiresMigration,
            riskLevel: requiresMigration ? 'medium' : 'low',
          }
        },
      },

      decompose: {
        async decompose(design, t) {
          const tasks: TaskGraph['tasks'] = []

          if (design.requiresMigration) {
            tasks.push({
              id: 'db-migration-01',
              title: 'Add category_threshold_pct column to price_rules',
              kind: 'db_migration',
              dependsOn: [],
              status: 'pending',
            })
          }

          const migrationDep = design.requiresMigration ? ['db-migration-01'] : []
          for (const mod of design.affectedModules) {
            tasks.push({
              id: `backend-${mod}`,
              title: `Update ${mod} module for category threshold`,
              kind: 'backend',
              dependsOn: [...migrationDep],
              status: 'pending',
            })
          }

          const codeDeps = tasks.filter((t) => t.kind === 'backend').map((t) => t.id)
          tasks.push({
            id: 'test-01',
            title: 'Unit + integration tests for category threshold',
            kind: 'test',
            dependsOn: codeDeps,
            status: 'pending',
          })

          tasks.push({
            id: 'security-scan-01',
            title: 'Security scan on all changed files',
            kind: 'security_scan',
            dependsOn: ['test-01'],
            status: 'pending',
          })

          return {
            ticketId: t.context.agentId ?? 'unknown',
            tasks,
            createdAt: new Date().toISOString(),
          }
        },
      },

      code: {
        async execute(taskId, kind, context): Promise<CodeResult> {
          if (failureInjection?.stage === 5) {
            return { taskId, success: false, filesChanged: [], error: failureInjection.error }
          }

          const files: string[] = []
          const ctx = context as Record<string, unknown>
          const task = ctx.task as { title?: string } | undefined

          if (kind === 'db_migration') {
            const fileName = `migrations/001_add_category_threshold.sql`
            const content = [
              '-- Migration: Add category-specific price threshold',
              '-- Generated by DB Agent (Autonomous Dev Loop Stage 05)',
              '',
              'ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS category_threshold_pct NUMERIC(5,2);',
              '',
              "UPDATE price_rules SET category_threshold_pct = 15.00 WHERE category_threshold_pct IS NULL;",
              '',
              'ALTER TABLE price_rules ALTER COLUMN category_threshold_pct SET NOT NULL;',
              'ALTER TABLE price_rules ALTER COLUMN category_threshold_pct SET DEFAULT 15.00;',
              '',
              "COMMENT ON COLUMN price_rules.category_threshold_pct IS 'Per-category price change threshold percentage';",
            ].join('\n')
            evidence.generatedFiles.push(fileName)
            evidence.fileContents[fileName] = content
            files.push(fileName)
          } else if (kind === 'backend') {
            const modName = taskId.replace('backend-', '')
            const fileName = `src/${modName}-category-threshold.ts`
            let content = [
              `// ${task?.title ?? taskId}`,
              `// Generated by Backend Agent (Autonomous Dev Loop Stage 05)`,
              '',
              `import type { TenantHarness } from '@patioer/harness'`,
              '',
              `export interface CategoryThresholdConfig {`,
              `  category: string`,
              `  thresholdPct: number`,
              `}`,
              '',
              `export function getCategoryThreshold(`,
              `  configs: CategoryThresholdConfig[],`,
              `  category: string,`,
              `  defaultThreshold = 15,`,
              `): number {`,
              `  const match = configs.find((c) => c.category === category)`,
              `  return match?.thresholdPct ?? defaultThreshold`,
              `}`,
            ].join('\n')

            if (securityInjection?.insertSecret && modName === 'price-sentinel') {
              content += `\n\n// TODO: move to env\nconst SHOPIFY_KEY = 'shpat_hardcoded_secret_12345'\n`
            }

            evidence.generatedFiles.push(fileName)
            evidence.fileContents[fileName] = content
            files.push(fileName)
          } else if (kind === 'test') {
            const fileName = `src/category-threshold.test.ts`
            const content = [
              `import { describe, expect, it } from 'vitest'`,
              ``,
              `describe('getCategoryThreshold', () => {`,
              `  it('returns category-specific threshold', () => {`,
              `    expect(true).toBe(true) // stub`,
              `  })`,
              ``,
              `  it('returns default 15% when no category match', () => {`,
              `    expect(true).toBe(true) // stub`,
              `  })`,
              `})`,
            ].join('\n')
            evidence.generatedFiles.push(fileName)
            evidence.fileContents[fileName] = content
            files.push(fileName)
          }
          // security_scan kind: no files generated

          return { taskId, success: true, filesChanged: files }
        },
      },

      qa: {
        async runTests(): Promise<QaResult> {
          return { passed: true, coveragePct: 87, failedTests: [] }
        },
      },

      security: {
        async scan(): Promise<SecurityResult> {
          securityAttempt++

          if (securityInjection?.insertSecret) {
            if (securityAttempt === 1) {
              const finding = { severity: 'high', description: 'Hardcoded Shopify API key: shpat_hardcoded_secret_12345' }
              evidence.securityFindings.push(finding)

              if (securityInjection.fixOnRetry) {
                // On next attempt, the "fix" is applied: remove the secret from generated code
                const psFile = 'src/price-sentinel-category-threshold.ts'
                if (evidence.fileContents[psFile]) {
                  evidence.fileContents[psFile] = evidence.fileContents[psFile]
                    .replace(/\n\n\/\/ TODO:.*\nconst SHOPIFY_KEY.*\n/, '\n')
                }
              }

              return { passed: false, vulnerabilities: [finding] }
            }
            // Second attempt: fixed
            return { passed: true, vulnerabilities: [] }
          }

          // Scan generated files for common security patterns
          const vulns: Array<{ severity: string; description: string }> = []
          for (const [file, content] of Object.entries(evidence.fileContents)) {
            if (/shpat_|sk_live_|AKIA[A-Z0-9]{16}/.test(content)) {
              vulns.push({ severity: 'critical', description: `Hardcoded secret in ${file}` })
            }
            if (/['"`]\s*SELECT\s.*\+\s/.test(content)) {
              vulns.push({ severity: 'high', description: `Potential SQL injection in ${file}` })
            }
          }

          if (vulns.length > 0) {
            evidence.securityFindings.push(...vulns)
            return { passed: false, vulnerabilities: vulns }
          }
          return { passed: true, vulnerabilities: [] }
        },
      },

      approval: {
        async requestApproval(ctx) {
          evidence.approvalRequests.push({
            runId: ctx.runId,
            ticketId: ctx.ticketId,
            summary: ctx.summary,
          })
          return ctx.ticketId
        },
      },

      deploy: {
        async deploy(ctx) {
          if (failureInjection?.stage === 8) {
            return { success: false, ref: '', error: failureInjection.error }
          }
          return { success: true, ref: `sha-${ctx.runId.slice(0, 8)}` }
        },
      },

      sre: {
        async monitor(_ref, _watchMs): Promise<SreResult> {
          if (failureInjection?.stage === 9) {
            return {
              healthy: false,
              metrics: { errorRate: 0.15, p99LatencyMs: 3200 },
              anomalies: [failureInjection.error],
            }
          }
          return {
            healthy: true,
            metrics: { errorRate: 0.002, p99LatencyMs: 95 },
            anomalies: [],
          }
        },
      },

      devosClient: {
        async createTicket(t) {
          const id = `followup-${Date.now()}`
          evidence.followUpTickets.push({ type: t.type, priority: t.priority, title: t.title })
          return { ticketId: id }
        },
        async getTicketStatus() { return 'open' },
        async acknowledgeTicket() {},
        async resolveTicket() {},
      },
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractModules(description: string): string[] {
  const modules: string[] = []
  const patterns: Array<[RegExp, string]> = [
    [/price.?sentinel/i, 'price-sentinel'],
    [/dataos|feature.?store/i, 'dataos'],
    [/harness/i, 'harness'],
    [/inventory/i, 'inventory-guard'],
  ]
  for (const [pattern, mod] of patterns) {
    if (pattern.test(description) && !modules.includes(mod)) {
      modules.push(mod)
    }
  }
  return modules
}
