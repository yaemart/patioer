/**
 * Lightweight `/metrics` smoke check: fetches the Prometheus scrape endpoint
 * and verifies that every required metric family name appears in the response.
 * Used locally (`pnpm seed:devos` style one-liner) or in CI integration tests.
 */

export interface SmokeCheckResult {
  ok: boolean
  missingMetrics: string[]
  sampleCount: number
}

export async function sreMetricsSmokeCheck(params: {
  metricsUrl: string
  requiredMetrics: string[]
  fetch?: typeof fetch
  timeoutMs?: number
}): Promise<SmokeCheckResult> {
  const fetchFn = params.fetch ?? globalThis.fetch
  const timeout = params.timeoutMs ?? 5000

  let body: string
  try {
    const res = await fetchFn(params.metricsUrl, {
      signal: AbortSignal.timeout(timeout),
    })
    body = await res.text()
  } catch {
    return { ok: false, missingMetrics: [...params.requiredMetrics], sampleCount: 0 }
  }

  const missingMetrics = params.requiredMetrics.filter((m) => !body.includes(m))

  const sampleLines = body.split('\n').filter(
    (l) => l.length > 0 && !l.startsWith('#'),
  )

  return {
    ok: missingMetrics.length === 0,
    missingMetrics,
    sampleCount: sampleLines.length,
  }
}
