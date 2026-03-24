import type { AlertmanagerAlert, AlertmanagerWebhookPayload } from './alertmanager-webhook-payload.js'
import type { DevOsClient } from './devos-client.js'
import type { DevOsTicket, DevOsTicketPriority, DevOsTicketType } from './ticket-protocol.js'
import { defaultSlaForPriority } from './ticket-protocol.js'
import { sreAlertDevOsPriority } from './sre-alert-catalog.js'

const HARNESS_ALERTS = new Set(['ElectroOsHarnessErrorRateHigh'])

function deriveTicketType(alertName: string): DevOsTicketType {
  if (HARNESS_ALERTS.has(alertName)) return 'harness_update'
  return 'performance'
}

/** 单条 firing alert → DevOsTicket。 */
export function alertToDevOsTicket(alert: AlertmanagerAlert): DevOsTicket {
  const alertName = alert.labels.alertname ?? 'UnknownAlert'
  const priority: DevOsTicketPriority = sreAlertDevOsPriority(alertName) ?? 'P1'
  const type = deriveTicketType(alertName)

  return {
    type,
    priority,
    title: `[SRE] ${alertName}`,
    description: alert.annotations.description || alert.annotations.summary || alertName,
    context: {
      errorLog: `alert=${alertName} status=${alert.status} startsAt=${alert.startsAt}`,
      reproSteps: [`fingerprint=${alert.fingerprint}`, `severity=${alert.labels.severity ?? 'unknown'}`],
    },
    sla: defaultSlaForPriority(priority),
  }
}

export interface AlertWebhookResult {
  created: number
  skipped: number
  errors: Array<{ fingerprint: string; error: string }>
  ticketIds: string[]
}

/** 批量处理 webhook payload：仅对 firing 告警创建 Ticket，resolved 忽略。 */
export async function handleAlertmanagerWebhook(params: {
  payload: AlertmanagerWebhookPayload
  client: DevOsClient
}): Promise<AlertWebhookResult> {
  const result: AlertWebhookResult = {
    created: 0,
    skipped: 0,
    errors: [],
    ticketIds: [],
  }

  for (const alert of params.payload.alerts) {
    if (alert.status !== 'firing') {
      result.skipped += 1
      continue
    }
    try {
      const ticket = alertToDevOsTicket(alert)
      const { ticketId } = await params.client.createTicket(ticket)
      result.ticketIds.push(ticketId)
      result.created += 1
    } catch (err) {
      result.errors.push({
        fingerprint: alert.fingerprint,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
