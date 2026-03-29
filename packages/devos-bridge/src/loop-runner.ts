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
    const ports = createRehearsalPorts(evidence, this.options)

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REHEARSAL_ACCEPTANCE_CRITERIA = [
  '品类阈值可独立配置',
  '现有全局 15% 阈值作为默认值保留',
  '测试覆盖率 ≥80%',
  '向后兼容：无品类配置时使用全局阈值',
]

const ARCHITECTURE_APPROACH = [
  '1. 新增 price_rules.category_threshold_pct 列（DB migration）',
  '2. Price Sentinel 查询时按品类匹配阈值，无匹配则 fallback 15%',
  '3. DataOS Feature Store upsert 时携带品类信息',
  '4. 全量单元测试 + 集成测试覆盖',
].join('\n')

const MIGRATION_FILE = 'migrations/001_add_category_threshold.sql'
const TEST_FILE = 'src/category-threshold.test.ts'
const PRICE_SENTINEL_FIXTURE_FILE = 'src/price-sentinel-category-threshold.ts'
const HARDCODED_SECRET_LINE = "\n\n// TODO: move to env\nconst SHOPIFY_KEY = 'shpat_hardcoded_secret_12345'\n"

function createRehearsalPorts(
  evidence: LoopRunEvidence,
  options: LoopRunnerOptions,
): LoopAgentPorts {
  const fixture = createRehearsalFixture(evidence, options.securityInjection)

  return {
    pm: createPmPort(),
    architect: createArchitectPort(),
    decompose: createDecomposePort(),
    code: createCodePort(fixture, options.failureInjection),
    qa: createQaPort(),
    security: createSecurityPort(fixture),
    approval: createApprovalPort(evidence),
    deploy: createDeployPort(options.failureInjection),
    sre: createSrePort(options.failureInjection),
    devosClient: createDevosClientPort(evidence),
  }
}

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

function createPmPort(): LoopAgentPorts['pm'] {
  return {
    async analyze(ticket) {
      const hasMigration = ticket.description.toLowerCase().includes('migration')
      const moduleCount = (ticket.description.match(/修改|更新|影响/g) ?? []).length
      return {
        summary: `${ticket.title} — ${ticket.description.split('\n')[0]}`,
        acceptanceCriteria: REHEARSAL_ACCEPTANCE_CRITERIA,
        estimatedComplexity: hasMigration && moduleCount >= 2 ? 'high' : moduleCount >= 1 ? 'medium' : 'low',
      }
    },
  }
}

function createArchitectPort(): LoopAgentPorts['architect'] {
  return {
    async design(_analysis, ticket) {
      const lowerDescription = ticket.description.toLowerCase()
      const requiresMigration = lowerDescription.includes('migration')
        || lowerDescription.includes('column')
        || lowerDescription.includes('表')
      const affectedModules = extractModules(ticket.description)

      return {
        approach: ARCHITECTURE_APPROACH,
        affectedModules: affectedModules.length > 0 ? affectedModules : ['price-sentinel', 'dataos'],
        requiresMigration,
        riskLevel: requiresMigration ? 'medium' : 'low',
      }
    },
  }
}

function createDecomposePort(): LoopAgentPorts['decompose'] {
  return {
    async decompose(design, ticket) {
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

      const migrationDependencies = design.requiresMigration ? ['db-migration-01'] : []
      for (const moduleName of design.affectedModules) {
        tasks.push({
          id: `backend-${moduleName}`,
          title: `Update ${moduleName} module for category threshold`,
          kind: 'backend',
          dependsOn: migrationDependencies,
          status: 'pending',
        })
      }

      const backendTaskIds = tasks.filter((task) => task.kind === 'backend').map((task) => task.id)
      tasks.push({
        id: 'test-01',
        title: 'Unit + integration tests for category threshold',
        kind: 'test',
        dependsOn: backendTaskIds,
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
        ticketId: ticket.context.agentId ?? 'unknown',
        tasks,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

function createQaPort(): LoopAgentPorts['qa'] {
  return {
    async runTests(): Promise<QaResult> {
      return { passed: true, coveragePct: 87, failedTests: [] }
    },
  }
}

function createApprovalPort(evidence: LoopRunEvidence): LoopAgentPorts['approval'] {
  return {
    async requestApproval(ctx) {
      evidence.approvalRequests.push({
        runId: ctx.runId,
        ticketId: ctx.ticketId,
        summary: ctx.summary,
      })
      return ctx.ticketId
    },
  }
}

function createDeployPort(failureInjection?: FailureInjection): LoopAgentPorts['deploy'] {
  return {
    async deploy(ctx) {
      if (failureInjection?.stage === 8) {
        return { success: false, ref: '', error: failureInjection.error }
      }
      return { success: true, ref: `sha-${ctx.runId.slice(0, 8)}` }
    },
  }
}

function createSrePort(failureInjection?: FailureInjection): LoopAgentPorts['sre'] {
  return {
    async monitor(): Promise<SreResult> {
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
  }
}

function createDevosClientPort(evidence: LoopRunEvidence): NonNullable<LoopAgentPorts['devosClient']> {
  return {
    async createTicket(ticket) {
      const id = `followup-${Date.now()}`
      evidence.followUpTickets.push({ type: ticket.type, priority: ticket.priority, title: ticket.title })
      return { ticketId: id }
    },
    async getTicketStatus() { return 'open' },
    async acknowledgeTicket() {},
    async resolveTicket() {},
  }
}

interface RehearsalFixture {
  codePort: LoopAgentPorts['code']
  securityPort: LoopAgentPorts['security']
}

function createRehearsalFixture(
  evidence: LoopRunEvidence,
  securityInjection?: SecurityInjection,
): RehearsalFixture {
  let securityAttempt = 0

  return {
    codePort: {
      async execute(taskId, kind, context): Promise<CodeResult> {
        return executeFixtureTask(evidence, securityInjection, taskId, kind, context)
      },
    },
    securityPort: {
      async scan(): Promise<SecurityResult> {
        securityAttempt++
        return scanFixtureFiles(evidence, securityInjection, securityAttempt)
      },
    },
  }
}

function createCodePort(
  fixture: RehearsalFixture,
  failureInjection?: FailureInjection,
): LoopAgentPorts['code'] {
  return {
    async execute(taskId, kind, context) {
      if (failureInjection?.stage === 5) {
        return { taskId, success: false, filesChanged: [], error: failureInjection.error }
      }
      return fixture.codePort.execute(taskId, kind, context)
    },
  }
}

function createSecurityPort(fixture: RehearsalFixture): LoopAgentPorts['security'] {
  return fixture.securityPort
}

function executeFixtureTask(
  evidence: LoopRunEvidence,
  securityInjection: SecurityInjection | undefined,
  taskId: string,
  kind: string,
  context: unknown,
): Promise<CodeResult> {
  const filesChanged: string[] = []
  const ctx = context as Record<string, unknown>
  const task = ctx.task as { title?: string } | undefined

  if (kind === 'db_migration') {
    writeGeneratedFile(evidence, MIGRATION_FILE, buildMigrationFile())
    filesChanged.push(MIGRATION_FILE)
  } else if (kind === 'backend') {
    const moduleName = taskId.replace('backend-', '')
    const fileName = `src/${moduleName}-category-threshold.ts`
    writeGeneratedFile(
      evidence,
      fileName,
      buildBackendFile(task?.title ?? taskId, securityInjection?.insertSecret === true && moduleName === 'price-sentinel'),
    )
    filesChanged.push(fileName)
  } else if (kind === 'test') {
    writeGeneratedFile(evidence, TEST_FILE, buildTestFile())
    filesChanged.push(TEST_FILE)
  }

  return Promise.resolve({ taskId, success: true, filesChanged })
}

function scanFixtureFiles(
  evidence: LoopRunEvidence,
  securityInjection: SecurityInjection | undefined,
  securityAttempt: number,
): Promise<SecurityResult> {
  if (securityInjection?.insertSecret && securityAttempt === 1) {
    const finding = { severity: 'high', description: 'Hardcoded Shopify API key: shpat_hardcoded_secret_12345' }
    evidence.securityFindings.push(finding)

    if (securityInjection.fixOnRetry && evidence.fileContents[PRICE_SENTINEL_FIXTURE_FILE]) {
      evidence.fileContents[PRICE_SENTINEL_FIXTURE_FILE] = evidence.fileContents[PRICE_SENTINEL_FIXTURE_FILE]
        .replace(HARDCODED_SECRET_LINE, '\n')
    }

    return Promise.resolve({ passed: false, vulnerabilities: [finding] })
  }

  const vulnerabilities: Array<{ severity: string; description: string }> = []
  for (const [fileName, content] of Object.entries(evidence.fileContents)) {
    if (/shpat_|sk_live_|AKIA[A-Z0-9]{16}/.test(content)) {
      vulnerabilities.push({ severity: 'critical', description: `Hardcoded secret in ${fileName}` })
    }
    if (/['"`]\s*SELECT\s.*\+\s/.test(content)) {
      vulnerabilities.push({ severity: 'high', description: `Potential SQL injection in ${fileName}` })
    }
  }

  if (vulnerabilities.length > 0) {
    evidence.securityFindings.push(...vulnerabilities)
    return Promise.resolve({ passed: false, vulnerabilities })
  }

  return Promise.resolve({ passed: true, vulnerabilities: [] })
}

function writeGeneratedFile(
  evidence: LoopRunEvidence,
  fileName: string,
  content: string,
): void {
  evidence.generatedFiles.push(fileName)
  evidence.fileContents[fileName] = content
}

function buildMigrationFile(): string {
  return [
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
}

function buildBackendFile(taskTitle: string, injectSecret: boolean): string {
  let content = [
    `// ${taskTitle}`,
    '// Generated by Backend Agent (Autonomous Dev Loop Stage 05)',
    '',
    "import type { TenantHarness } from '@patioer/harness'",
    '',
    'export interface CategoryThresholdConfig {',
    '  category: string',
    '  thresholdPct: number',
    '}',
    '',
    'export function getCategoryThreshold(',
    '  configs: CategoryThresholdConfig[],',
    '  category: string,',
    '  defaultThreshold = 15,',
    '): number {',
    '  const match = configs.find((c) => c.category === category)',
    '  return match?.thresholdPct ?? defaultThreshold',
    '}',
  ].join('\n')

  if (injectSecret) {
    content += HARDCODED_SECRET_LINE
  }

  return content
}

function buildTestFile(): string {
  return [
    "import { describe, expect, it } from 'vitest'",
    '',
    "describe('getCategoryThreshold', () => {",
    "  it('returns category-specific threshold', () => {",
    '    expect(true).toBe(true) // stub',
    '  })',
    '',
    "  it('returns default 15% when no category match', () => {",
    '    expect(true).toBe(true) // stub',
    '  })',
    '})',
  ].join('\n')
}
