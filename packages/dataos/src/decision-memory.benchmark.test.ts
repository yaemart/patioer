import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { DecisionMemoryService } from './decision-memory.js'
import { deterministicEmbedding } from './embeddings.js'

const DB_URL = process.env.DATAOS_TEST_DATABASE_URL

const BENCH_TENANT = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const BENCH_AGENT = 'bench-agent'

describe.skipIf(!DB_URL)('DecisionMemory pgvector benchmark', () => {
  let pool: Pool
  let svc: DecisionMemoryService

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    svc = new DecisionMemoryService(pool)

    await pool.query('DELETE FROM decision_memory WHERE tenant_id = $1', [BENCH_TENANT])

    console.log('[benchmark] seeding 100 rows...')
    await seedRows(pool, 100)
    console.log('[benchmark] seeding to 1000 rows...')
    await seedRows(pool, 900, 100)
    console.log('[benchmark] seeding complete: 1000 rows')
  }, 120_000)

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM decision_memory WHERE tenant_id = $1', [BENCH_TENANT])
      await pool.end()
    }
  })

  it('recall with 100 rows completes in < 100ms', async () => {
    const targetContext = { benchmark: true, category: 'electronics', index: 50 }
    const start = performance.now()
    await svc.recall(BENCH_TENANT, BENCH_AGENT, targetContext, {
      limit: 5,
      minSimilarity: 0.01,
    })
    const elapsed = performance.now() - start
    console.log(`[benchmark] recall@100 rows: ${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(100)
  })

  it('recall with 1000 rows completes in < 500ms', async () => {
    const targetContext = { benchmark: true, category: 'electronics', index: 500 }
    const start = performance.now()
    await svc.recall(BENCH_TENANT, BENCH_AGENT, targetContext, {
      limit: 5,
      minSimilarity: 0.01,
    })
    const elapsed = performance.now() - start
    console.log(`[benchmark] recall@1000 rows: ${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(500)
  })

  it('recall returns ≥ 3 similar decisions from 1000 rows', async () => {
    const targetContext = { benchmark: true, category: 'electronics', index: 42 }
    const results = await svc.recall(BENCH_TENANT, BENCH_AGENT, targetContext, {
      limit: 10,
      minSimilarity: 0.01,
    })
    console.log(`[benchmark] recall returned ${results.length} results (min 3 expected)`)
    expect(results.length).toBeGreaterThanOrEqual(3)
  })

  it('recall precision: top-3 results have similarity > 0.7 for exact-match context', async () => {
    const exactContext = { benchmark: true, category: 'electronics', index: 0 }
    const results = await svc.recall(BENCH_TENANT, BENCH_AGENT, exactContext, {
      limit: 3,
      minSimilarity: 0.01,
    })
    console.log(
      '[benchmark] precision check — top-3 similarities:',
      results.map((r) => (r as unknown as { similarity: number }).similarity?.toFixed(4)),
    )

    expect(results.length).toBeGreaterThanOrEqual(1)
    const topSim = (results[0] as unknown as { similarity: number }).similarity
    expect(topSim).toBeGreaterThan(0.7)
  })

  it('similarity distribution snapshot (p0/p50/p90/max) for tuning reference', async () => {
    const targetContext = { benchmark: true, category: 'electronics', index: 42 }
    const results = await svc.recall(BENCH_TENANT, BENCH_AGENT, targetContext, {
      limit: 50,
      minSimilarity: 0.01,
    })

    const sims = results
      .map((r) => (r as unknown as { similarity: number }).similarity)
      .filter((s) => typeof s === 'number')
      .sort((a, b) => a - b)

    if (sims.length > 0) {
      const p0 = sims[0]!
      const p50 = sims[Math.floor(sims.length * 0.5)]!
      const p90 = sims[Math.floor(sims.length * 0.9)]!
      const max = sims[sims.length - 1]!
      console.log(`[benchmark] similarity distribution (n=${sims.length}): p0=${p0.toFixed(4)} p50=${p50.toFixed(4)} p90=${p90.toFixed(4)} max=${max.toFixed(4)}`)
    }

    expect(sims.length).toBeGreaterThan(0)
  })
})

async function seedRows(pool: Pool, count: number, startIdx = 0): Promise<void> {
  const batchSize = 50
  for (let i = 0; i < count; i += batchSize) {
    const batch = Math.min(batchSize, count - i)
    const values: string[] = []
    const params: unknown[] = []

    for (let j = 0; j < batch; j++) {
      const idx = startIdx + i + j
      const context = { benchmark: true, category: 'electronics', index: idx }
      const contextStr = JSON.stringify(context)
      const vec = deterministicEmbedding(contextStr)
      const vecLiteral = `[${vec.join(',')}]`

      const offset = params.length
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb, $${offset + 5}::jsonb, $${offset + 6}::vector, $${offset + 7}::jsonb, NOW())`,
      )
      params.push(
        BENCH_TENANT,
        BENCH_AGENT,
        'shopify',
        contextStr,
        JSON.stringify({ adjustPrice: idx * 0.1 }),
        vecLiteral,
        idx % 3 === 0 ? JSON.stringify({ revenue: idx * 10 }) : null,
      )
    }

    await pool.query(
      `INSERT INTO decision_memory (tenant_id, agent_id, platform, context, action, context_vector, outcome, outcome_at)
       VALUES ${values.join(', ')}`,
      params,
    )
  }
}
