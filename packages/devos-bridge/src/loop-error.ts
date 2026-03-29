/**
 * LoopError — Autonomous Dev Loop 结构化错误（Phase 4 §S8 任务 8.2）
 *
 * 当 Loop 某阶段检测到违反质量门的情况时，抛出 LoopError 打回当前 Stage。
 * Loop 主协调器捕获后决定：重试、降级还是终止本次循环。
 *
 * Constitution §7.2：禁止降低覆盖率（≥80%）→ coverage_below_80
 * Constitution §9：安全漏洞必须修复 → security_issues
 */

export type LoopErrorCode =
  | 'coverage_below_80'      // Stage 06：QA Agent 检测到行覆盖率 < 80%
  | 'security_issues'        // Stage 06：Security Agent 发现未修复漏洞
  | 'deployment_failed'      // Stage 08：DevOps Agent 部署失败
  | 'approval_timeout'       // Stage 07：人工审批超时
  | 'approval_rejected'      // Stage 07：人工审批被拒绝
  | 'health_check_failed'    // Stage 09：SRE Agent 健康检查失败
  | 'rollback_triggered'     // Stage 09：SRE 触发自动回滚
  | 'task_graph_cycle'       // Stage 04：PM/Architect 生成了有环 TaskGraph
  | 'agent_budget_exceeded'  // 任意阶段：Agent 预算超限
  | 'stage_timeout'          // 任意阶段：单阶段执行超时

export interface LoopErrorContext {
  ticketId?: string
  stage?: number
  agentId?: string
  details?: string
  coverage?: number      // for coverage_below_80
  vulnerabilities?: number // for security_issues
}

export class LoopError extends Error {
  readonly code: LoopErrorCode
  readonly context: LoopErrorContext

  constructor(code: LoopErrorCode, context: LoopErrorContext = {}) {
    super(LoopError.formatMessage(code, context))
    this.name = 'LoopError'
    this.code = code
    this.context = context
  }

  private static formatMessage(code: LoopErrorCode, ctx: LoopErrorContext): string {
    const stage = ctx.stage !== undefined ? ` [Stage ${ctx.stage.toString().padStart(2, '0')}]` : ''
    const ticket = ctx.ticketId ? ` ticket=${ctx.ticketId}` : ''
    switch (code) {
      case 'coverage_below_80':
        return `LoopError${stage}: code coverage ${ctx.coverage ?? '?'}% < 80% threshold (Constitution §7.2)${ticket}`
      case 'security_issues':
        return `LoopError${stage}: ${ctx.vulnerabilities ?? '?'} security issue(s) unresolved (Constitution §9)${ticket}`
      case 'deployment_failed':
        return `LoopError${stage}: deployment failed — ${ctx.details ?? 'unknown error'}${ticket}`
      case 'approval_timeout':
        return `LoopError${stage}: human approval timed out${ticket}`
      case 'approval_rejected':
        return `LoopError${stage}: human approval rejected — ${ctx.details ?? 'no reason given'}${ticket}`
      case 'health_check_failed':
        return `LoopError${stage}: SRE health check failed — ${ctx.details ?? 'unhealthy'}${ticket}`
      case 'rollback_triggered':
        return `LoopError${stage}: SRE triggered automatic rollback${ticket}`
      case 'task_graph_cycle':
        return `LoopError${stage}: TaskGraph contains a cycle — ${ctx.details ?? ''}${ticket}`
      case 'agent_budget_exceeded':
        return `LoopError${stage}: agent ${ctx.agentId ?? '?'} exceeded monthly budget${ticket}`
      case 'stage_timeout':
        return `LoopError${stage}: stage execution timed out${ticket}`
      default: {
        const _exhaustive: never = code
        return `LoopError: unknown code ${String(_exhaustive)}`
      }
    }
  }

}
