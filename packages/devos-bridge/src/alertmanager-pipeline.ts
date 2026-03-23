import type { DevOsClient } from './devos-client.js'
import type { AlertDedupStore } from './alert-dedup.js'
import type { AlertWebhookResult } from './alertmanager-to-ticket.js'
import type { SreResponseSuggestion } from './sre-response-suggestion.js'
import { parseAlertmanagerPayload } from './alertmanager-webhook-payload.js'
import { alertToDevOsTicket } from './alertmanager-to-ticket.js'
import { buildSreResponseSuggestion } from './sre-response-suggestion.js'

export interface AlertPipelineResult {
  webhookResult: AlertWebhookResult
  suggestions: SreResponseSuggestion[]
  dedupSkipped: number
  parseError?: boolean
}

/**
 * End-to-end pipeline: raw body → parse → dedup → create tickets → SRE suggestions.
 * Returns `parseError: true` with zero-value webhookResult when body is invalid.
 */
export async function runAlertmanagerPipeline(params: {
  body: unknown
  client: DevOsClient
  dedup?: AlertDedupStore
}): Promise<AlertPipelineResult> {
  const empty: AlertWebhookResult = { created: 0, skipped: 0, errors: [], ticketIds: [] }

  const payload = parseAlertmanagerPayload(params.body)
  if (!payload) {
    return { webhookResult: empty, suggestions: [], dedupSkipped: 0, parseError: true }
  }

  const result: AlertWebhookResult = { created: 0, skipped: 0, errors: [], ticketIds: [] }
  const suggestions: SreResponseSuggestion[] = []
  let dedupSkipped = 0

  for (const alert of payload.alerts) {
    if (alert.status !== 'firing') {
      result.skipped += 1
      continue
    }

    if (params.dedup?.has(alert.fingerprint)) {
      dedupSkipped += 1
      continue
    }

    try {
      const ticket = alertToDevOsTicket(alert)
      const { ticketId } = await params.client.createTicket(ticket)
      result.ticketIds.push(ticketId)
      result.created += 1
      params.dedup?.add(alert.fingerprint)

      const alertName = alert.labels.alertname ?? 'UnknownAlert'
      suggestions.push(buildSreResponseSuggestion(alertName))
    } catch (err) {
      result.errors.push({
        fingerprint: alert.fingerprint,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { webhookResult: result, suggestions, dedupSkipped }
}
