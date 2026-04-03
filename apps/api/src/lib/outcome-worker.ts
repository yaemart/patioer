import type { Job } from 'bullmq'
import { getEvaluator, type OutcomeResult } from '@patioer/agent-runtime'
import { tryCreateDataOsPort } from './dataos-port.js'
import { outcomeEvaluationTotal } from '../plugins/metrics.js'

export interface OutcomeJobPayload {
  scope: string
  decisionId: string
  tenantId: string
  decisionPayload: Record<string, unknown>
}

/**
 * BullMQ job processor for delayed outcome evaluation.
 *
 * Jobs are enqueued with a delay (e.g. 7 days) after an agent decision.
 * When the delay expires this worker evaluates the business impact
 * and writes the outcome back via DataOsPort.writeOutcome().
 */
export async function processOutcomeJob(job: Job<OutcomeJobPayload>): Promise<void> {
  const { scope, decisionId, tenantId, decisionPayload } = job.data

  const evaluator = getEvaluator(scope)
  if (!evaluator) {
    outcomeEvaluationTotal.labels(scope, 'no_evaluator').inc()
    console.warn(`[outcome-worker] No evaluator registered for scope "${scope}", skipping evaluation`)
    return
  }

  let result: OutcomeResult
  try {
    result = await evaluator.evaluate(decisionId, tenantId, decisionPayload)
    outcomeEvaluationTotal.labels(scope, result.verdict).inc()
  } catch (err) {
    outcomeEvaluationTotal.labels(scope, 'error').inc()
    console.error(`[outcome-worker] Evaluator threw for ${scope} decision ${decisionId}:`, err)
    return
  }

  const dataOS = tryCreateDataOsPort(tenantId, 'amazon')
  if (dataOS) {
    await dataOS.writeOutcome(decisionId, result)
    outcomeEvaluationTotal.labels(scope, 'persisted').inc()
    console.log(
      `[outcome-worker] Persisted outcome for ${scope} decision ${decisionId}: verdict=${result.verdict}`,
    )
  } else {
    outcomeEvaluationTotal.labels(scope, 'dataos_unavailable').inc()
    console.log(
      `[outcome-worker] DataOS unavailable — logged only: ${scope} decision ${decisionId} for tenant ${tenantId}`,
      JSON.stringify(result.metrics),
    )
  }
}

/**
 * Compute the delay in ms for a given number of days.
 */
export function buildOutcomeJobOpts(evaluateDelayDays: number): { delay: number } {
  return { delay: evaluateDelayDays * 86_400_000 }
}
