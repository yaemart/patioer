import type { PaperclipBridge, TicketParams } from '@patioer/agent-runtime'

/**
 * DG-03: Product Scout / Agent `createTicket` → Paperclip Issues API.
 * Best-effort: failures return `paperclipError` so callers can still persist audit rows.
 */
export interface AgentPaperclipTicketResult {
  paperclipIssue?: { issueId: string; url: string; status: string }
  paperclipError?: string
}

export async function createIssueForAgentTicket(
  bridge: PaperclipBridge | null,
  tenantId: string,
  agentId: string,
  params: TicketParams,
): Promise<AgentPaperclipTicketResult> {
  if (!bridge) return {}

  try {
    const res = await bridge.createIssue({
      title: params.title,
      description: params.body,
      priority: 'medium',
      agentId,
      context: { tenantId, source: 'electroos-agent' },
    })
    return {
      paperclipIssue: { issueId: res.issueId, url: res.url, status: res.status },
    }
  } catch (e) {
    return { paperclipError: e instanceof Error ? e.message : String(e) }
  }
}
