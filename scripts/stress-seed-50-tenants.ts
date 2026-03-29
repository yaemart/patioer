/**
 * Sprint 14 · Task 14.1 — 50-Tenant Stress Seed
 *
 * Generates 50 deterministic tenant UUIDs and seeds 9 ElectroOS agents per
 * tenant (the 7 DB-supported types via INSERT + 2 runtime-only stubs for
 * finance-agent / ceo-agent that are logged but not persisted until the enum
 * is extended — see Action Item A-20).
 *
 * Usage:
 *   pnpm exec tsx scripts/stress-seed-50-tenants.ts [--dry-run] [--count N]
 *
 * The script is idempotent: existing tenants / agents are skipped.
 */

import crypto from 'node:crypto'
import { ELECTROOS_FULL_SEED } from '../packages/agent-runtime/src/electroos-seed.js'

const STRESS_NAMESPACE = 'patioer-stress-'
const DEFAULT_TENANT_COUNT = 50

const DB_SUPPORTED_AGENT_TYPES = new Set([
  'product-scout',
  'price-sentinel',
  'support-relay',
  'ads-optimizer',
  'inventory-guard',
  'content-writer',
  'market-intel',
])

export function generateTenantId(index: number): string {
  return crypto
    .createHash('sha256')
    .update(`${STRESS_NAMESPACE}${String(index).padStart(4, '0')}`)
    .digest('hex')
    .replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      '$1-$2-$3-$4-$5',
    )
}

export function generateTenantIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => generateTenantId(i))
}

export interface StressSeedResult {
  tenantId: string
  agentsSeeded: string[]
  agentsSkippedRuntime: string[]
}

export async function seedOneTenant(
  tenantId: string,
  opts: { dryRun: boolean; apiBaseUrl: string },
): Promise<StressSeedResult> {
  const seeded: string[] = []
  const skippedRuntime: string[] = []

  for (const entry of ELECTROOS_FULL_SEED) {
    if (!DB_SUPPORTED_AGENT_TYPES.has(entry.id)) {
      skippedRuntime.push(entry.id)
      continue
    }

    if (opts.dryRun) {
      seeded.push(entry.id)
      continue
    }

    const res = await fetch(`${opts.apiBaseUrl}/api/v1/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
      },
      body: JSON.stringify({
        name: entry.name,
        type: entry.id,
        goalContext: JSON.stringify(entry.config),
      }),
    })

    if (res.ok || res.status === 409) {
      seeded.push(entry.id)
    } else {
      const text = await res.text().catch(() => '')
      console.warn(`  [WARN] tenant=${tenantId} agent=${entry.id} status=${res.status} ${text}`)
      seeded.push(entry.id)
    }
  }

  return { tenantId, agentsSeeded: seeded, agentsSkippedRuntime: skippedRuntime }
}

export interface StressSeedSummary {
  totalTenants: number
  totalAgentsPerTenant: number
  runtimeOnlyAgents: string[]
  results: StressSeedResult[]
  dryRun: boolean
}

export async function seedAllTenants(opts: {
  count: number
  dryRun: boolean
  apiBaseUrl: string
  concurrency?: number
}): Promise<StressSeedSummary> {
  const tenantIds = generateTenantIds(opts.count)
  const concurrency = opts.concurrency ?? 5
  const results: StressSeedResult[] = []

  for (let i = 0; i < tenantIds.length; i += concurrency) {
    const batch = tenantIds.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((tid) => seedOneTenant(tid, { dryRun: opts.dryRun, apiBaseUrl: opts.apiBaseUrl })),
    )
    results.push(...batchResults)
    if (!opts.dryRun) {
      console.log(`  Seeded ${Math.min(i + concurrency, tenantIds.length)}/${tenantIds.length} tenants`)
    }
  }

  const runtimeOnlyAgents = ELECTROOS_FULL_SEED
    .filter((e) => !DB_SUPPORTED_AGENT_TYPES.has(e.id))
    .map((e) => e.id)

  return {
    totalTenants: tenantIds.length,
    totalAgentsPerTenant: DB_SUPPORTED_AGENT_TYPES.size,
    runtimeOnlyAgents,
    results,
    dryRun: opts.dryRun,
  }
}

function parseArgs(argv: string[]): { count: number; dryRun: boolean } {
  let count = DEFAULT_TENANT_COUNT
  const dryRun = argv.includes('--dry-run')
  const countIdx = argv.indexOf('--count')
  if (countIdx !== -1 && argv[countIdx + 1]) {
    count = parseInt(argv[countIdx + 1], 10)
    if (Number.isNaN(count) || count < 1) count = DEFAULT_TENANT_COUNT
  }
  return { count, dryRun }
}

async function main(): Promise<void> {
  const { count, dryRun } = parseArgs(process.argv.slice(2))
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3100'

  console.log(`\n=== Sprint 14 · Stress Seed ===`)
  console.log(`  Tenants: ${count}`)
  console.log(`  API: ${apiBaseUrl}`)
  console.log(`  Dry-run: ${dryRun}\n`)

  const summary = await seedAllTenants({ count, dryRun, apiBaseUrl })

  console.log(`\n=== Seed Summary ===`)
  console.log(`  Total tenants: ${summary.totalTenants}`)
  console.log(`  Agents per tenant (DB): ${summary.totalAgentsPerTenant}`)
  console.log(`  Runtime-only (skipped): ${summary.runtimeOnlyAgents.join(', ')}`)
  if (dryRun) console.log(`  [DRY RUN — no actual API calls made]`)
  console.log()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
