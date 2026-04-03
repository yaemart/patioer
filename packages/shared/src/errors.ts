export type AgentError =
  | { type: 'budget_exceeded'; agentId: string }
  | { type: 'approval_required'; reason: string; payload: unknown }
  | { type: 'harness_error'; platform: string; code: string; message: string }
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'tenant_not_found'; tenantId: string }
  | {
      type: 'sop_scenario_error'
      code:
        | 'template_not_found'
        | 'locked_field_violation'
        | 'parser_extraction_failed'
        | 'version_conflict'
      scenarioId: string
      detail: string
    }
  | {
      type: 'degraded_mode'
      reason: 'missing_profit_data' | 'account_health_risk' | 'cash_flow_pressure'
      agentId: string
    }
