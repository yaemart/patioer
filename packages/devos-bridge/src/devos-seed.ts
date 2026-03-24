/**
 * DevOS 种子：通过 DevOS HTTP 创建一条「工程组织 + SRE」bootstrap 记录（Task 5.5）。
 */
import type { DevOsClient } from './devos-client.js'
import { DEVOS_ENGINEERING_ORG, buildSreBootstrapTicket } from './devos-org-chart.js'

export interface DevOsSeedResult {
  ticketId: string
  dryRun: boolean
}

export async function runDevOsSeed(params: {
  client: DevOsClient
  dryRun: boolean
}): Promise<DevOsSeedResult> {
  const ticket = buildSreBootstrapTicket(DEVOS_ENGINEERING_ORG)
  if (params.dryRun) {
    return { ticketId: '(dry-run)', dryRun: true }
  }
  const { ticketId } = await params.client.createTicket(ticket)
  return { ticketId, dryRun: false }
}
