import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import metricsPlugin, {
  agentHeartbeatGauge,
  harnessErrorTotal,
  metricsRegistry,
  tenantRequestCounter,
  webhookDispatchNoHandlerTotal,
  webhookHandlerErrorsTotal,
} from './metrics.js'

// Build a lightweight Fastify instance with only the metrics plugin registered.
// Re-using buildServer() would register prom-client collectDefaultMetrics twice
// across test suites and trigger "metric already registered" errors.
function buildMetricsApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(metricsPlugin)
  return app
}

beforeEach(async () => {
  // Reset all metric values between tests to prevent cross-test pollution
  metricsRegistry.resetMetrics()
})

afterEach(async () => {
  metricsRegistry.resetMetrics()
})

describe('GET /metrics — Prometheus endpoint', () => {
  it('returns 200 with text/plain content-type', async () => {
    const app = buildMetricsApp()

    const res = await app.inject({ method: 'GET', url: '/metrics' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
  })

  it('response body contains all custom application metric names', async () => {
    const app = buildMetricsApp()
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/metrics' })
    const body = res.body

    expect(body).toContain('harness_error_total')
    expect(body).toContain('api_request_duration_seconds')
    expect(body).toContain('tenant_request_total')
    expect(body).toContain('agent_heartbeat_last_timestamp')
    expect(body).toContain('webhook_handler_errors_total')
    expect(body).toContain('webhook_dispatch_no_handler_total')
  })

  it('api_request_duration_seconds_count increments after a request', async () => {
    const app = buildMetricsApp()
    // Add a dummy route so we can fire a real request through the onResponse hook
    app.get('/ping', async () => ({ ok: true }))

    await app.inject({ method: 'GET', url: '/ping' })

    const metrics = await metricsRegistry.getMetricsAsJSON()
    const histogram = metrics.find((m) => m.name === 'api_request_duration_seconds')
    expect(histogram).toBeDefined()
    // After one request the histogram should have recorded values (values array non-empty)
    expect((histogram?.values ?? []).length).toBeGreaterThan(0)
  })
})

describe('Individual metric exports', () => {
  it('harnessErrorTotal.inc() updates the counter', async () => {
    harnessErrorTotal.labels('shopify', 'getProduct', 'NetworkError').inc()

    const metrics = await metricsRegistry.getMetricsAsJSON()
    const counter = metrics.find((m) => m.name === 'harness_error_total')
    const value = counter?.values.find(
      (v) =>
        v.labels['platform'] === 'shopify' &&
        v.labels['method'] === 'getProduct' &&
        v.labels['error_type'] === 'NetworkError',
    )
    expect(value?.value).toBe(1)
  })

  it('agentHeartbeatGauge.set() records the timestamp', async () => {
    const now = Math.floor(Date.now() / 1000)
    agentHeartbeatGauge.labels('price-sentinel', 'tenant-42').set(now)

    const metrics = await metricsRegistry.getMetricsAsJSON()
    const gauge = metrics.find((m) => m.name === 'agent_heartbeat_last_timestamp')
    const sample = gauge?.values.find(
      (v) => v.labels['agent_type'] === 'price-sentinel' && v.labels['tenant_id'] === 'tenant-42',
    )
    expect(sample?.value).toBe(now)
  })
})

describe('webhook metrics', () => {
  it('webhookDispatchNoHandlerTotal and webhookHandlerErrorsTotal increment', async () => {
    webhookDispatchNoHandlerTotal.labels('tiktok').inc(2)
    webhookHandlerErrorsTotal.labels('amazon', 'amazon:ORDER_CHANGE').inc()

    const metrics = await metricsRegistry.getMetricsAsJSON()
    const noHandler = metrics.find((m) => m.name === 'webhook_dispatch_no_handler_total')
    const err = metrics.find((m) => m.name === 'webhook_handler_errors_total')
    expect(noHandler?.values.find((v) => v.labels['platform'] === 'tiktok')?.value).toBe(2)
    expect(
      err?.values.find(
        (v) => v.labels['platform'] === 'amazon' && v.labels['topic'] === 'amazon:ORDER_CHANGE',
      )?.value,
    ).toBe(1)
  })
})

describe('tenantRequestCounter', () => {
  it('increments separately per tenant+platform label pair', async () => {
    tenantRequestCounter.labels('tenant-A', 'shopify').inc(3)
    tenantRequestCounter.labels('tenant-B', 'amazon').inc(1)

    const metrics = await metricsRegistry.getMetricsAsJSON()
    const counter = metrics.find((m) => m.name === 'tenant_request_total')
    const shopify = counter?.values.find(
      (v) => v.labels['tenant_id'] === 'tenant-A' && v.labels['platform'] === 'shopify',
    )
    const amazon = counter?.values.find(
      (v) => v.labels['tenant_id'] === 'tenant-B' && v.labels['platform'] === 'amazon',
    )
    expect(shopify?.value).toBe(3)
    expect(amazon?.value).toBe(1)
  })
})
