import { describe, expect, it, vi } from 'vitest'
import { sreMetricsSmokeCheck } from './sre-smoke-check.js'

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue({
    text: async () => body,
    ok: status >= 200 && status < 300,
    status,
  })
}

const SAMPLE_METRICS_BODY = [
  '# HELP harness_error_total Total harness errors',
  '# TYPE harness_error_total counter',
  'harness_error_total{platform="shopify"} 3',
  '# HELP api_request_duration_seconds HTTP latency',
  '# TYPE api_request_duration_seconds histogram',
  'api_request_duration_seconds_bucket{le="0.5"} 10',
  'api_request_duration_seconds_bucket{le="1"} 15',
  '# HELP electroos_db_pool_usage_ratio PG pool',
  '# TYPE electroos_db_pool_usage_ratio gauge',
  'electroos_db_pool_usage_ratio 0.42',
].join('\n')

describe('sreMetricsSmokeCheck', () => {
  it('returns ok when all required metrics present', async () => {
    const result = await sreMetricsSmokeCheck({
      metricsUrl: 'http://localhost:3100/metrics',
      requiredMetrics: ['harness_error_total', 'electroos_db_pool_usage_ratio'],
      fetch: mockFetch(SAMPLE_METRICS_BODY) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.missingMetrics).toHaveLength(0)
    expect(result.sampleCount).toBeGreaterThan(0)
  })

  it('detects missing metric in response', async () => {
    const result = await sreMetricsSmokeCheck({
      metricsUrl: 'http://localhost:3100/metrics',
      requiredMetrics: ['harness_error_total', 'some_metric_that_does_not_exist'],
      fetch: mockFetch(SAMPLE_METRICS_BODY) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.missingMetrics).toContain('some_metric_that_does_not_exist')
  })

  it('returns ok:false when fetch fails', async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await sreMetricsSmokeCheck({
      metricsUrl: 'http://localhost:3100/metrics',
      requiredMetrics: ['harness_error_total'],
      fetch: failFetch as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.missingMetrics).toEqual(['harness_error_total'])
    expect(result.sampleCount).toBe(0)
  })
})
