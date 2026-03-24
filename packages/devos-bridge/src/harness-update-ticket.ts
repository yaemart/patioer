import type { DevOsClient } from './devos-client.js'
import type { DevOsTicket, DevOsTicketPriority } from './ticket-protocol.js'
import { defaultSlaForPriority, isDevOsTicket } from './ticket-protocol.js'

/** 与 `toHarnessErrorWire` 对齐，并可选附带租户 / Agent 上下文。 */
export interface HarnessErrorReport {
  platform: string
  code: string
  message: string
  tenantId?: string
  agentId?: string
}

const P2_CODES = new Set<string>([
  '404',
  'product_not_found',
  'variant_not_found',
  'location_not_found',
])

/** 按 code 粗分 P1（默认严重）与 P2（典型「资源不存在」类），供 SRE 队列降噪。 */
export function deriveHarnessUpdatePriority(report: HarnessErrorReport): DevOsTicketPriority {
  return P2_CODES.has(report.code) ? 'P2' : 'P1'
}

/** 构造 `type: harness_update` 的 `DevOsTicket`（context.errorLog / reproSteps 可检索）。 */
export function buildHarnessUpdateTicket(report: HarnessErrorReport): DevOsTicket {
  const priority = deriveHarnessUpdatePriority(report)
  const title = `[${report.platform}] harness ${report.code}`
  const description = report.message
  const ticket: DevOsTicket = {
    type: 'harness_update',
    priority,
    title,
    description,
    context: {
      platform: report.platform,
      tenantId: report.tenantId,
      agentId: report.agentId,
      errorLog: `${report.code}: ${report.message}`,
      reproSteps: [`platform=${report.platform}`, `code=${report.code}`],
    },
    sla: defaultSlaForPriority(priority),
  }
  if (!isDevOsTicket(ticket)) {
    throw new Error('harness_update_ticket_invalid')
  }
  return ticket
}

export async function reportHarnessErrorToDevOs(params: {
  client: DevOsClient
  report: HarnessErrorReport
  dryRun?: boolean
}): Promise<{ ticketId: string; dryRun: boolean }> {
  const ticket = buildHarnessUpdateTicket(params.report)
  if (params.dryRun) return { ticketId: '', dryRun: true }
  const { ticketId } = await params.client.createTicket(ticket)
  return { ticketId, dryRun: false }
}
