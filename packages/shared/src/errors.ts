export type AgentError =
  | { type: 'budget_exceeded'; agentId: string }
  | { type: 'approval_required'; reason: string; payload: unknown }
  | { type: 'harness_error'; platform: string; code: string; message: string }
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'tenant_not_found'; tenantId: string }
