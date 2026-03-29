/**
 * AutonomousDevLoop — DevOS 9 阶段自主开发循环（Phase 4 §S8 任务 8.4–8.6）
 *
 * 实现 Blueprint §03 定义的 9 阶段流水线：
 *   Stage 01: Ticket Intake       — 接收 ElectroOS 上报的 Ticket
 *   Stage 02: PM Analysis         — PM Agent 分析需求，输出 PRD
 *   Stage 03: Architect Design    — Architect Agent 设计方案
 *   Stage 04: Task Decomposition  — PM + DB Agent 生成 TaskGraph
 *   Stage 05: Agent Execute       — Backend/Frontend/DB Agent 并行编码
 *   Stage 06: Code Review         — QA Agent（覆盖率）+ Security Agent（漏洞）
 *   Stage 07: Human Approval Gate — 唯一人工节点（Constitution §5.4）
 *   Stage 08: Deploy              — DevOps Agent 执行部署
 *   Stage 09: Monitor & Optimize  — SRE Agent 监控，异常则回滚 + 创建新 Ticket
 *
 * ADR-0004 D19 / Constitution §7.1 / AC-P4-01~06
 */

import type { DevOsTicket } from './ticket-protocol.js'
import type { DevOsClient } from './devos-client.js'
import { LoopContext, type EventSink, type LoopRunSummary } from './loop-context.js'
import { LoopError, type LoopErrorCode, type LoopErrorContext } from './loop-error.js'
import { type TaskGraph, topologicalSort, parallelWaves } from './task-graph.js'

// ─── Agent Port Interfaces ────────────────────────────────────────────────────

export interface PmAgentPort {
  analyze(ticket: DevOsTicket): Promise<PmAnalysisResult>
}

export interface PmAnalysisResult {
  summary: string
  acceptanceCriteria: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
}

export interface ArchitectAgentPort {
  design(analysis: PmAnalysisResult, ticket: DevOsTicket): Promise<ArchDesignResult>
}

export interface ArchDesignResult {
  approach: string
  affectedModules: string[]
  requiresMigration: boolean
  riskLevel: 'low' | 'medium' | 'high'
}

export interface PmDecomposePort {
  decompose(design: ArchDesignResult, ticket: DevOsTicket): Promise<TaskGraph>
}

export interface CodeAgentPort {
  execute(taskId: string, kind: string, context: unknown): Promise<CodeResult>
}

export interface CodeResult {
  taskId: string
  success: boolean
  filesChanged: string[]
  error?: string
}

export interface QaAgentPort {
  runTests(): Promise<QaResult>
}

export interface QaResult {
  passed: boolean
  coveragePct: number
  failedTests: string[]
}

export interface SecurityAgentPort {
  scan(): Promise<SecurityResult>
}

export interface SecurityResult {
  passed: boolean
  vulnerabilities: Array<{ severity: string; description: string }>
}

export interface ApprovalPort {
  /** Returns the approved ticketId, or throws if rejected/timed out. */
  requestApproval(context: ApprovalContext): Promise<string>
}

export interface ApprovalContext {
  runId: string
  ticketId: string
  summary: string
  taskGraph: TaskGraph
  qaResult?: QaResult
  securityResult?: SecurityResult
}

export interface DeployAgentPort {
  deploy(context: DeployContext): Promise<DeployResult>
}

export interface DeployContext {
  runId: string
  ticketId: string
  taskGraph: TaskGraph
}

export interface DeployResult {
  success: boolean
  ref: string
  error?: string
}

export interface SreAgentPort {
  /** Monitor for `watchDurationMs`. Returns health status. */
  monitor(ref: string, watchDurationMs: number): Promise<SreResult>
}

export interface SreResult {
  healthy: boolean
  metrics: Record<string, number>
  anomalies: string[]
}

// ─── Loop Configuration ───────────────────────────────────────────────────────

export interface AutonomousLoopConfig {
  /** Tenant for event lake writes (Constitution §6.1). */
  tenantId: string
  /** SRE monitoring window in ms. Default: 10 minutes (AC-P4-05). */
  sreDurationMs?: number
  /** Maximum retries for Stage 06 (cover/security) before failing. */
  maxCodeReviewRetries?: number
}

// ─── Loop Agent Ports Bundle ──────────────────────────────────────────────────

export interface LoopAgentPorts {
  pm: PmAgentPort
  architect: ArchitectAgentPort
  decompose: PmDecomposePort
  code: CodeAgentPort
  qa: QaAgentPort
  security: SecurityAgentPort
  approval: ApprovalPort
  deploy: DeployAgentPort
  sre: SreAgentPort
  devosClient?: DevOsClient
  eventSink?: EventSink
}

// ─── AutonomousDevLoop ────────────────────────────────────────────────────────

export class AutonomousDevLoop {
  private readonly sreDurationMs: number
  private readonly maxCodeReviewRetries: number

  constructor(
    private readonly config: AutonomousLoopConfig,
    private readonly ports: LoopAgentPorts,
  ) {
    this.sreDurationMs = config.sreDurationMs ?? 10 * 60 * 1000
    this.maxCodeReviewRetries = config.maxCodeReviewRetries ?? 2
  }

  /**
   * Run the full 9-stage Autonomous Dev Loop for a given Ticket.
   * Returns a LoopRunSummary for both success and handled failure cases.
   * Unexpected infrastructure exceptions still bubble up.
   */
  async run(ticket: DevOsTicket, runId: string): Promise<LoopRunSummary> {
    const ctx = new LoopContext(runId, ticket.context.agentId ?? runId, this.config.tenantId, this.ports.eventSink)

    // ── Stage 01: Ticket Intake ──────────────────────────────────────────
    ctx.beginStage(1)
    ctx.completeStage(1, { type: ticket.type, priority: ticket.priority, title: ticket.title })

    // ── Stage 02: PM Analysis ────────────────────────────────────────────
    ctx.beginStage(2)
    const pmResult = await this.ports.pm.analyze(ticket)
    ctx.completeStage(2, { summary: pmResult.summary, complexity: pmResult.estimatedComplexity })

    // ── Stage 03: Architect Design ───────────────────────────────────────
    ctx.beginStage(3)
    const archResult = await this.ports.architect.design(pmResult, ticket)
    ctx.completeStage(3, {
      approach: archResult.approach,
      requiresMigration: archResult.requiresMigration,
      risk: archResult.riskLevel,
    })

    // ── Stage 04: Task Decomposition ─────────────────────────────────────
    ctx.beginStage(4)
    let taskGraph: TaskGraph
    try {
      taskGraph = await this.ports.decompose.decompose(archResult, ticket)
      topologicalSort(taskGraph) // validate: throws TaskGraphCycleError on cycle
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.failStage(4, msg)
      return this.failRun(ctx, 'task_graph_cycle', {
        ticketId: ticket.context.agentId,
        stage: 4,
        details: msg,
      })
    }
    ctx.setTaskGraph(taskGraph)
    ctx.completeStage(4, { taskCount: taskGraph.tasks.length })

    // ── Stage 05: Agent Execute (parallel per wave) ──────────────────────
    ctx.beginStage(5)
    const waves = parallelWaves(taskGraph)
    const codeResults: CodeResult[] = []

    for (const wave of waves) {
      const waveResults = await Promise.all(
        wave.map((task) =>
          this.ports.code
            .execute(task.id, task.kind, { task, archResult, ticket })
            .then((r) => {
              task.status = r.success ? 'done' : 'failed'
              task.completedAt = new Date().toISOString()
              return r
            }),
        ),
      )
      codeResults.push(...waveResults)
    }

    const failedTasks = codeResults.filter((r) => !r.success)
    if (failedTasks.length > 0) {
      ctx.failStage(5, `${failedTasks.length} task(s) failed`, { failedTasks: failedTasks.map((r) => r.taskId) })
      return this.failRun(ctx, 'code_execution_failed', {
        stage: 5,
        ticketId: ticket.context.agentId,
        details: `Code execution failed for: ${failedTasks.map((r) => r.taskId).join(', ')}`,
      })
    }
    ctx.completeStage(5, {
      filesChanged: codeResults.flatMap((r) => r.filesChanged),
      taskCount: codeResults.length,
    })

    // ── Stage 06: Code Review (QA + Security) ────────────────────────────
    // AC-P4-02: coverage < 80% → failure summary with code "coverage_below_80"
    // AC-P4-03: security issues → failure summary with code "security_issues"
    let qaResult: QaResult | undefined
    let secResult: SecurityResult | undefined

    for (let attempt = 1; attempt <= this.maxCodeReviewRetries; attempt++) {
      ctx.beginStage(6, { attempt })

      const [qa, sec] = await Promise.all([
        this.ports.qa.runTests(),
        this.ports.security.scan(),
      ])
      qaResult = qa
      secResult = sec

      if (!qa.passed || qa.coveragePct < 80) {
        ctx.failStage(6, `Coverage ${qa.coveragePct}% < 80%`, { coverage: qa.coveragePct, attempt })
        if (attempt >= this.maxCodeReviewRetries) {
          return this.failRun(ctx, 'coverage_below_80', {
            stage: 6,
            ticketId: ticket.context.agentId,
            coverage: qa.coveragePct,
          })
        }
        continue
      }

      if (!sec.passed || sec.vulnerabilities.length > 0) {
        ctx.failStage(6, `${sec.vulnerabilities.length} security issue(s)`, {
          vulnerabilities: sec.vulnerabilities.length,
          attempt,
        })
        if (attempt >= this.maxCodeReviewRetries) {
          return this.failRun(ctx, 'security_issues', {
            stage: 6,
            ticketId: ticket.context.agentId,
            vulnerabilities: sec.vulnerabilities.length,
          })
        }
        continue
      }

      ctx.completeStage(6, { coverage: qa.coveragePct, vulnerabilities: 0, attempt })
      break
    }

    // ── Stage 07: Human Approval Gate ────────────────────────────────────
    // Constitution §5.4: DevOS 部署到生产，任何情况，人工审批
    // AC-P4-04: 未审批时 DevOps Agent 不执行部署
    ctx.beginStage(7)
    try {
      const approvedId = await this.ports.approval.requestApproval({
        runId,
        ticketId: ticket.context.agentId ?? runId,
        summary: pmResult.summary,
        taskGraph,
        qaResult,
        securityResult: secResult,
      })
      ctx.completeStage(7, { approvedId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.failStage(7, msg)
      const code = msg.toLowerCase().includes('reject') ? 'approval_rejected' : 'approval_timeout'
      return this.failRun(ctx, code, { stage: 7, ticketId: ticket.context.agentId, details: msg })
    }

    // ── Stage 08: Deploy ─────────────────────────────────────────────────
    ctx.beginStage(8)
    const deployResult = await this.ports.deploy.deploy({ runId, ticketId: ticket.context.agentId ?? runId, taskGraph })
    if (!deployResult.success) {
      ctx.failStage(8, deployResult.error ?? 'deploy failed', { ref: deployResult.ref })
      return this.failRun(ctx, 'deployment_failed', {
        stage: 8,
        ticketId: ticket.context.agentId,
        details: deployResult.error,
      })
    }
    ctx.setDeployedRef(deployResult.ref)
    ctx.completeStage(8, { ref: deployResult.ref })

    // ── Stage 09: Monitor & Optimize ────────────────────────────────────
    // AC-P4-05: SRE 监控 10min，异常 → DevOps 回滚 + 新 Ticket
    ctx.beginStage(9)
    const sreResult = await this.ports.sre.monitor(deployResult.ref, this.sreDurationMs)

    if (!sreResult.healthy) {
      ctx.failStage(9, `SRE detected anomalies: ${sreResult.anomalies.join(', ')}`, {
        metrics: sreResult.metrics,
        anomalies: sreResult.anomalies,
      })

      // Create a follow-up Ticket for the failure (Loop continues)
      if (this.ports.devosClient) {
        await this.ports.devosClient.createTicket({
          type: 'bug',
          priority: 'P0',
          title: `[Loop ${runId}] Post-deploy health check failed`,
          description: `SRE detected: ${sreResult.anomalies.join(', ')}`,
          context: { agentId: 'sre-agent' },
          sla: { acknowledge: '1h', resolve: '4h' },
        })
      }

      return this.failRun(ctx, 'health_check_failed', {
        stage: 9,
        ticketId: ticket.context.agentId,
        details: sreResult.anomalies.join('; '),
      })
    }

    ctx.completeStage(9, { metrics: sreResult.metrics, ref: deployResult.ref })
    ctx.complete('success')

    return ctx.getSummary()
  }

  private failRun(
    ctx: LoopContext,
    code: LoopErrorCode,
    errorContext: LoopErrorContext,
  ): LoopRunSummary {
    const failure = new LoopError(code, errorContext)
    ctx.complete('failure', { code, details: failure.message })
    return ctx.getSummary()
  }
}
