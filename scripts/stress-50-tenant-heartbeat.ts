/**
 * Sprint 14 · Task 14.2 — 50 Tenant Concurrent Heartbeat Simulation
 *
 * Runs HeartbeatRunner for N tenants in parallel, each executing `cyclesPerTenant`
 * heartbeat cycles. In real deployment a cycle runs every 5 minutes → 288 cycles / 24h.
 * For stress testing we run the configured number of cycles at full speed.
 *
 * Usage:
 *   pnpm exec tsx scripts/stress-50-tenant-heartbeat.ts [--tenants 50] [--cycles 288]
 *
 * Output: JSON evidence file written to docs/ops/sprint14-stress-evidence.json
 */

import { HeartbeatRunner, type HeartbeatRunEvidence } from '../packages/agent-runtime/src/heartbeat-runner.js'
import type { AgentContext } from '../packages/agent-runtime/src/context.js'
import { generateTenantIds } from './stress-seed-50-tenants.js'

export interface TenantHeartbeatResult {
  tenantId: string
  evidence: HeartbeatRunEvidence
}

export interface StressHeartbeatSummary {
  startedAt: string
  completedAt: string
  totalTenants: number
  cyclesPerTenant: number
  totalCycles: number
  totalTicks: number
  totalFailures: number
  allHealthy: boolean
  peakConcurrency: number
  durationMs: number
  tenantResults: TenantHeartbeatResult[]
}

function createStressMockCtx(tenantId: string, agentId: string): AgentContext {
  return {
    tenantId,
    agentId,
    getHarness: () => ({
      tenantId,
      platformId: 'shopify',
      getProduct: async () => null,
      getProductsPage: async () => ({ items: [] }),
      getProducts: async () => [
        { id: 'p-1', title: 'Widget', price: 19.99, inventory: 50 },
      ],
      updatePrice: async () => undefined,
      updateInventory: async () => undefined,
      getOrdersPage: async () => ({ items: [] }),
      getOrders: async () => [],
      replyToMessage: async () => undefined,
      getOpenThreads: async () => [],
      getAnalytics: async () => ({ revenue: 1000, orders: 50 }),
    }),
    getEnabledPlatforms: () => ['shopify'],
    llm: async () => ({
      text: JSON.stringify({
        insights: ['Heartbeat OK'],
        additionalConflicts: [],
        recommendations: ['Continue monitoring.'],
        title: 'Test Product',
        description: 'Test desc',
        bulletPoints: [],
        seoKeywords: [],
        competitorMinPrice: 15,
        competitorAvgPrice: 20,
        pricePosition: 'below',
      }),
    }),
    budget: { isExceeded: async () => false },
    logAction: async () => undefined,
    requestApproval: async () => undefined,
    createTicket: async () => undefined,
    describeDataOsCapabilities: () => 'DataOS is not available. Stress test mode.',
  } as unknown as AgentContext
}

export async function runTenantHeartbeat(
  tenantId: string,
  cycles: number,
): Promise<TenantHeartbeatResult> {
  const runner = new HeartbeatRunner({
    ctxFactory: (agentId) => createStressMockCtx(tenantId, agentId),
  })

  const evidence = await runner.runHeartbeat(cycles)
  return { tenantId, evidence }
}

export async function runStressHeartbeat(opts: {
  tenantCount: number
  cyclesPerTenant: number
  concurrency?: number
}): Promise<StressHeartbeatSummary> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const tenantIds = generateTenantIds(opts.tenantCount)
  const concurrency = opts.concurrency ?? 10
  const tenantResults: TenantHeartbeatResult[] = []

  let peakConcurrency = 0

  for (let i = 0; i < tenantIds.length; i += concurrency) {
    const batch = tenantIds.slice(i, i + concurrency)
    if (batch.length > peakConcurrency) peakConcurrency = batch.length

    const batchResults = await Promise.all(
      batch.map((tid) => runTenantHeartbeat(tid, opts.cyclesPerTenant)),
    )
    tenantResults.push(...batchResults)
    console.log(`  Completed ${Math.min(i + concurrency, tenantIds.length)}/${tenantIds.length} tenants`)
  }

  const totalCycles = tenantResults.reduce((s, r) => s + r.evidence.totalCycles, 0)
  const totalTicks = tenantResults.reduce((s, r) => s + r.evidence.totalTicks, 0)
  const totalFailures = tenantResults.reduce((s, r) => s + r.evidence.failures.length, 0)

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    totalTenants: tenantResults.length,
    cyclesPerTenant: opts.cyclesPerTenant,
    totalCycles,
    totalTicks,
    totalFailures,
    allHealthy: totalFailures === 0,
    peakConcurrency,
    durationMs: Date.now() - t0,
    tenantResults,
  }
}

function parseArgs(argv: string[]): { tenants: number; cycles: number } {
  let tenants = 50
  let cycles = 288
  const tIdx = argv.indexOf('--tenants')
  if (tIdx !== -1 && argv[tIdx + 1]) {
    tenants = parseInt(argv[tIdx + 1], 10)
    if (Number.isNaN(tenants) || tenants < 1) tenants = 50
  }
  const cIdx = argv.indexOf('--cycles')
  if (cIdx !== -1 && argv[cIdx + 1]) {
    cycles = parseInt(argv[cIdx + 1], 10)
    if (Number.isNaN(cycles) || cycles < 1) cycles = 288
  }
  return { tenants, cycles }
}

async function main(): Promise<void> {
  const { tenants, cycles } = parseArgs(process.argv.slice(2))

  console.log(`\n=== Sprint 14 · 50-Tenant Heartbeat Stress Test ===`)
  console.log(`  Tenants: ${tenants}`)
  console.log(`  Cycles per tenant: ${cycles}`)
  console.log(`  Total expected ticks: ${tenants * cycles * 9}\n`)

  const summary = await runStressHeartbeat({
    tenantCount: tenants,
    cyclesPerTenant: cycles,
  })

  console.log(`\n=== Stress Heartbeat Summary ===`)
  console.log(`  Duration: ${summary.durationMs}ms`)
  console.log(`  Total cycles: ${summary.totalCycles}`)
  console.log(`  Total ticks: ${summary.totalTicks}`)
  console.log(`  Total failures: ${summary.totalFailures}`)
  console.log(`  All healthy: ${summary.allHealthy}`)
  console.log(`  Peak concurrency: ${summary.peakConcurrency}`)
  console.log()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
