import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { pool } from '@patioer/db'
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

// ─── Per-plugin registry ───────────────────────────────────────────────────────
//
// Using a dedicated Registry (rather than the global default) keeps instances
// isolated between tests: each buildServer() call gets its own registry so
// metric-name conflicts ("metric already registered") cannot occur across suites.

export const metricsRegistry = new Registry()

// ─── Metric definitions ────────────────────────────────────────────────────────

export const harnessErrorTotal = new Counter({
  name: 'harness_error_total',
  help: 'Total harness errors by platform and error type',
  labelNames: ['platform', 'method', 'error_type'] as const,
  registers: [metricsRegistry],
})

export const apiLatencyHistogram = new Histogram({
  name: 'api_request_duration_seconds',
  help: 'HTTP API request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
})

export const tenantRequestCounter = new Counter({
  name: 'tenant_request_total',
  help: 'Total requests by tenant and platform',
  labelNames: ['tenant_id', 'platform'] as const,
  registers: [metricsRegistry],
})

export const agentHeartbeatGauge = new Gauge({
  name: 'agent_heartbeat_last_timestamp',
  help: 'Unix timestamp of last successful agent heartbeat',
  labelNames: ['agent_type', 'tenant_id'] as const,
  registers: [metricsRegistry],
})

/** Active connections / pool max (0..1); Prometheus rule `electroos_db_pool_usage_ratio > 0.9` (Sprint 5.7). */
export const dbPoolUsageRatio = new Gauge({
  name: 'electroos_db_pool_usage_ratio',
  help: 'PostgreSQL pool active connections divided by max pool size (0..1)',
  registers: [metricsRegistry],
  collect() {
    const max = pool.options.max ?? 10
    const active = Math.max(0, pool.totalCount - pool.idleCount)
    const ratio = max > 0 ? Math.min(1, active / max) : 0
    this.set(ratio)
  },
})

/** Registered handler ran but threw — HTTP still returns 200 to avoid platform retries. */
export const webhookHandlerErrorsTotal = new Counter({
  name: 'webhook_handler_errors_total',
  help: 'Webhook topic handlers that threw after dispatch (by platform and topic)',
  labelNames: ['platform', 'topic'] as const,
  registers: [metricsRegistry],
})

/** No handler registered for topic — dispatch is a no-op (warn only). */
export const webhookDispatchNoHandlerTotal = new Counter({
  name: 'webhook_dispatch_no_handler_total',
  help: 'Multi-platform webhook dispatches with no registered handler',
  labelNames: ['platform'] as const,
  registers: [metricsRegistry],
})

export const authOperationTotal = new Counter({
  name: 'auth_operation_total',
  help: 'Auth operations by action and outcome',
  labelNames: ['action', 'outcome'] as const,
  registers: [metricsRegistry],
})

export const billingOperationTotal = new Counter({
  name: 'billing_operation_total',
  help: 'Billing operations by action and plan',
  labelNames: ['action', 'plan'] as const,
  registers: [metricsRegistry],
})

export const stripeWebhookTotal = new Counter({
  name: 'stripe_webhook_total',
  help: 'Stripe webhook events received by event type and outcome',
  labelNames: ['event_type', 'outcome'] as const,
  registers: [metricsRegistry],
})

export const onboardingStepTotal = new Counter({
  name: 'onboarding_step_total',
  help: 'Onboarding step completions by step number and outcome',
  labelNames: ['step', 'outcome'] as const,
  registers: [metricsRegistry],
})

export const onboardingCompletedTotal = new Counter({
  name: 'onboarding_completed_total',
  help: 'Total onboarding completions',
  registers: [metricsRegistry],
})

export const agentDecisionTotal = new Counter({
  name: 'agent_decision_total',
  help: 'Agent decisions by type and action outcome',
  labelNames: ['agent_type', 'action'] as const,
  registers: [metricsRegistry],
})

export const agentDecisionConfidence = new Histogram({
  name: 'agent_decision_confidence',
  help: 'Distribution of agent decision confidence scores',
  labelNames: ['agent_type'] as const,
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0],
  registers: [metricsRegistry],
})

export const agentDegradationTotal = new Counter({
  name: 'agent_degradation_total',
  help: 'Count of degraded agent decisions by flag type',
  labelNames: ['agent_type', 'flag'] as const,
  registers: [metricsRegistry],
})

export const agentDecisionQualityScore = new Gauge({
  name: 'agent_decision_quality_score',
  help: 'Rolling quality score (0-1) of agent decisions by agent type',
  labelNames: ['agent_type'] as const,
  registers: [metricsRegistry],
})

export const tenantGmvDaily = new Gauge({
  name: 'tenant_gmv_daily',
  help: 'Estimated daily GMV in USD by tenant',
  labelNames: ['tenant_id'] as const,
  registers: [metricsRegistry],
})

export const sopScenarioActiveCount = new Gauge({
  name: 'sop_scenario_active_count',
  help: 'Number of currently active SOP scenarios by tenant',
  labelNames: ['tenant_id'] as const,
  registers: [metricsRegistry],
})

export const outcomeEvaluationTotal = new Counter({
  name: 'outcome_evaluation_total',
  help: 'Delayed outcome evaluations by scope and result',
  labelNames: ['scope', 'result'] as const,
  registers: [metricsRegistry],
})

// ─── Fastify plugin ────────────────────────────────────────────────────────────

// Guard: collectDefaultMetrics must only be called once per registry instance.
// In tests multiple Fastify apps may register this plugin; the flag prevents
// the "metric already registered" error on the second invocation.
let _defaultMetricsStarted = false

async function metricsPlugin(fastify: FastifyInstance): Promise<void> {
  if (!_defaultMetricsStarted) {
    collectDefaultMetrics({ register: metricsRegistry })
    _defaultMetricsStarted = true
  }

  // GET /metrics — Prometheus scrape endpoint.
  // Protect with METRICS_SCRAPE_SECRET when set (recommended for non-internal deployments).
  // The tenant_id label on tenantRequestCounter is high-cardinality by design;
  // operators should ensure this endpoint is only reachable from the internal network or Prometheus.
  fastify.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const secret = process.env.METRICS_SCRAPE_SECRET
    if (secret) {
      const auth = (req.headers as Record<string, string>).authorization ?? ''
      if (auth.replace('Bearer ', '') !== secret) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    }
    reply.type('text/plain; version=0.0.4')
    return metricsRegistry.metrics()
  })

  // Automatically record HTTP request latency for every response.
  // Use the parameterised route pattern (e.g. /api/v1/agents/:id) rather than
  // the raw URL to avoid unbounded label cardinality.
  fastify.addHook('onResponse', (req, reply, done) => {
    // Fall back to a normalised sentinel — never use req.url which contains
    // real IDs and would create unlimited Prometheus time-series.
    const route = req.routeOptions?.url ?? '/*'
    apiLatencyHistogram
      .labels(req.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000)
    done()
  })
}

export default fp(metricsPlugin, {
  name: 'metrics',
  fastify: '5.x',
})
