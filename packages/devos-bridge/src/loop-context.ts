/**
 * LoopContext — Autonomous Dev Loop 运行上下文（Phase 4 §S8 任务 8.3）
 *
 * 每次 Loop 运行持有一个 LoopContext 实例，贯穿 Stage 01→09。
 * 负责：
 *   - 记录每个 Stage 的开始/结束时间和结果
 *   - 将阶段事件写入 DataOS Event Lake（agent_events）
 *   - 向 Decision Memory 记录关键决策（PM 分析、Architect 设计）
 *   - 提供 Stage 日志结构化输出
 *
 * Constitution §5.3：所有操作写入不可变审计日志（Paperclip Ticket + agent_events）
 */

import type { TaskGraph } from './task-graph.js'
import type { LoopErrorCode } from './loop-error.js'

export type LoopStage =
  | 1   // Ticket Intake
  | 2   // PM Analysis
  | 3   // Architect Design
  | 4   // Task Decomposition
  | 5   // Agent Execute (parallel)
  | 6   // Code Review (QA + Security)
  | 7   // Human Approval Gate
  | 8   // Deploy
  | 9   // Monitor & Optimize

export type StageResult = 'success' | 'failure' | 'skipped' | 'pending'

export interface StageLog {
  stage: LoopStage
  name: string
  startedAt: string
  completedAt?: string
  result: StageResult
  durationMs?: number
  details?: Record<string, unknown>
  error?: string
}

export interface LoopRunSummary {
  runId: string
  ticketId: string
  startedAt: string
  completedAt?: string
  currentStage: LoopStage
  overallResult: StageResult
  failureCode?: LoopErrorCode
  failureDetails?: string
  stages: StageLog[]
  taskGraph?: TaskGraph
  deployedRef?: string
}

/** Minimal interface for writing events to DataOS (injected dependency). */
export interface EventSink {
  insertEvent(event: {
    tenantId: string
    agentId: string
    eventType: string
    entityId?: string
    payload: unknown
    metadata?: unknown
  }): Promise<void>
}

const STAGE_NAMES: Record<LoopStage, string> = {
  1: 'Ticket Intake',
  2: 'PM Analysis',
  3: 'Architect Design',
  4: 'Task Decomposition',
  5: 'Agent Execute',
  6: 'Code Review',
  7: 'Human Approval Gate',
  8: 'Deploy',
  9: 'Monitor & Optimize',
}

export class LoopContext {
  private readonly stageLogs: Map<LoopStage, StageLog> = new Map()
  private overallResult: StageResult = 'pending'
  private taskGraph: TaskGraph | undefined
  private deployedRef: string | undefined
  private failureCode: LoopErrorCode | undefined
  private failureDetails: string | undefined

  constructor(
    readonly runId: string,
    readonly ticketId: string,
    readonly tenantId: string,
    private readonly eventSink?: EventSink,
  ) {}

  /** Mark a stage as started. Returns the stage log for chaining. */
  beginStage(stage: LoopStage, details?: Record<string, unknown>): StageLog {
    const log: StageLog = {
      stage,
      name: STAGE_NAMES[stage],
      startedAt: new Date().toISOString(),
      result: 'pending',
      details,
    }
    this.stageLogs.set(stage, log)
    void this.emit(`loop.stage.begin`, stage, { details })
    return log
  }

  /** Mark a stage as completed successfully. */
  completeStage(stage: LoopStage, details?: Record<string, unknown>): void {
    const log = this.stageLogs.get(stage)
    if (!log) return
    const now = new Date().toISOString()
    log.completedAt = now
    log.result = 'success'
    log.durationMs = new Date(now).getTime() - new Date(log.startedAt).getTime()
    if (details) log.details = { ...log.details, ...details }
    void this.emit(`loop.stage.complete`, stage, { durationMs: log.durationMs, details })
  }

  /** Mark a stage as failed with an error message. */
  failStage(stage: LoopStage, error: string, details?: Record<string, unknown>): void {
    const log = this.stageLogs.get(stage) ?? {
      stage,
      name: STAGE_NAMES[stage],
      startedAt: new Date().toISOString(),
      result: 'pending' as StageResult,
    }
    const now = new Date().toISOString()
    log.completedAt = now
    log.result = 'failure'
    log.error = error
    log.durationMs = new Date(now).getTime() - new Date(log.startedAt).getTime()
    if (details) log.details = { ...log.details, ...details }
    this.stageLogs.set(stage, log)
    void this.emit(`loop.stage.fail`, stage, { error, details })
  }

  /** Record the TaskGraph produced in Stage 04. */
  setTaskGraph(graph: TaskGraph): void {
    this.taskGraph = graph
    void this.emit('loop.task_graph.set', 4, { taskCount: graph.tasks.length, ticketId: graph.ticketId })
  }

  /** Record the deployment reference (git SHA / release tag) from Stage 08. */
  setDeployedRef(ref: string): void {
    this.deployedRef = ref
    void this.emit('loop.deployed', 8, { ref })
  }

  /** Mark the entire Loop run as complete (called from Stage 09). */
  complete(
    result: 'success' | 'failure',
    failure?: { code: LoopErrorCode; details?: string },
  ): void {
    this.overallResult = result
    this.failureCode = failure?.code
    this.failureDetails = failure?.details
    void this.emit('loop.run.complete', 9, {
      result,
      runId: this.runId,
      failureCode: failure?.code,
      failureDetails: failure?.details,
    })
  }

  /** Returns the current run summary. */
  getSummary(): LoopRunSummary {
    const stages = [...this.stageLogs.values()]
    const lastCompleted = stages.filter((s) => s.completedAt).at(-1)
    return {
      runId: this.runId,
      ticketId: this.ticketId,
      startedAt: stages[0]?.startedAt ?? new Date().toISOString(),
      completedAt: lastCompleted?.completedAt,
      currentStage: (stages.at(-1)?.stage ?? 1) as LoopStage,
      overallResult: this.overallResult,
      failureCode: this.failureCode,
      failureDetails: this.failureDetails,
      stages,
      taskGraph: this.taskGraph,
      deployedRef: this.deployedRef,
    }
  }

  private async emit(
    eventType: string,
    stage: LoopStage,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.eventSink) return
    try {
      await this.eventSink.insertEvent({
        tenantId: this.tenantId,
        agentId: 'autonomous-loop',
        eventType,
        entityId: this.ticketId,
        payload: {
          runId: this.runId,
          stage,
          stageName: STAGE_NAMES[stage],
          ...payload,
        },
      })
    } catch {
      // Event sink failures must never crash the Loop (Constitution §5.3 best-effort)
    }
  }
}
