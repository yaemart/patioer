export const AgentEventName = {
  AgentStarted: 'agent.started',
  AgentCompleted: 'agent.completed',
  AgentFailed: 'agent.failed',
  ApprovalRequested: 'approval.requested',
} as const

export type AgentEventName = (typeof AgentEventName)[keyof typeof AgentEventName]
