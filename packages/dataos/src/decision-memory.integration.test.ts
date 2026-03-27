import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { DecisionMemoryService } from './decision-memory.js'

const DB_URL = process.env.DATAOS_TEST_DATABASE_URL

const TENANT_INTEG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_INTEG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const TEST_TENANTS = [TENANT_INTEG_A, TENANT_INTEG_B]
const AGENT = 'price-sentinel'

describe.skipIf(!DB_URL)('DecisionMemory integration (requires real PG + pgvector)', () => {
  let pool: Pool
  let svc: DecisionMemoryService

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })

    const extCheck = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
    )
    if (extCheck.rowCount === 0) {
      throw new Error('pgvector extension not installed — run: CREATE EXTENSION vector')
    }

    await cleanup(pool)

    svc = new DecisionMemoryService(pool)
  })

  afterAll(async () => {
    if (pool) {
      await cleanup(pool)
      await pool.end()
    }
  })

  it('scaffolding: connects to PG and pgvector is available', async () => {
    const { rows } = await pool.query(`SELECT vector_dims('[1,2,3]'::vector) AS dims`)
    expect(rows[0].dims).toBe(3)
  })

  it('scaffolding: decision_memory table exists', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'decision_memory'
       ORDER BY ordinal_position`,
    )
    const columns = rows.map((r: { column_name: string }) => r.column_name)
    expect(columns).toContain('id')
    expect(columns).toContain('tenant_id')
    expect(columns).toContain('agent_id')
    expect(columns).toContain('context_vector')
    expect(columns).toContain('outcome')
  })

  describe('full lifecycle (record → recall → writeOutcome → delete)', () => {
    const CONTEXT = { price: 29.99, conv_rate: 0.02 }
    const DIFFERENT_CONTEXT = { category: 'electronics', weight: 500, brand: 'acme' }
    const ids: string[] = []

    it('record() inserts 3 decisions and returns valid UUIDs', async () => {
      const actions = [
        { newPrice: 27.99 },
        { newPrice: 26.99 },
        { newPrice: 28.49 },
      ]
      for (const action of actions) {
        const id = await svc.record({
          tenantId: TENANT_INTEG_A,
          agentId: AGENT,
          platform: 'shopify',
          entityId: 'P001',
          context: CONTEXT,
          action,
        })
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        )
        ids.push(id)
      }
      expect(ids).toHaveLength(3)
    })

    it('listRecent() returns all 3 recorded decisions', async () => {
      const rows = await svc.listRecent(TENANT_INTEG_A, AGENT)
      expect(rows.length).toBeGreaterThanOrEqual(3)
      for (const id of ids) {
        expect(rows.some((r) => r.id === id)).toBe(true)
      }
    })

    it('recall() returns 0 when outcome is NULL (no feedback value yet)', async () => {
      const rows = await svc.recall(TENANT_INTEG_A, AGENT, CONTEXT, {
        minSimilarity: 0.5,
      })
      expect(rows).toHaveLength(0)
    })

    it('writeOutcome() updates 2 decisions and sets outcome_at', async () => {
      await svc.writeOutcome(ids[0]!, TENANT_INTEG_A, {
        conv_rate_7d: 0.025,
        revenue_7d: 850,
      })
      await svc.writeOutcome(ids[1]!, TENANT_INTEG_A, {
        conv_rate_7d: 0.030,
        revenue_7d: 920,
      })

      const { rows } = await pool.query<{ outcome_at: string | null }>(
        `SELECT outcome_at FROM decision_memory WHERE id = ANY($1::uuid[])`,
        [[ids[0], ids[1]]],
      )
      for (const row of rows) {
        expect(row.outcome_at).not.toBeNull()
      }
    })

    it('recall() returns 2 decisions after outcomes are written (same context)', async () => {
      const rows = await svc.recall(TENANT_INTEG_A, AGENT, CONTEXT, {
        minSimilarity: 0.5,
      })
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.outcome).not.toBeNull()
        expect(row.tenant_id).toBe(TENANT_INTEG_A)
        expect(row.agent_id).toBe(AGENT)
      }
    })

    it('recall() returns similarity as number in [0, 1]', async () => {
      const rows = await svc.recall(TENANT_INTEG_A, AGENT, CONTEXT, {
        minSimilarity: 0.5,
      })
      for (const row of rows) {
        expect(typeof row.similarity).toBe('number')
        expect(row.similarity).toBeGreaterThanOrEqual(0)
        expect(row.similarity).toBeLessThanOrEqual(1)
      }
    })

    it('recall() returns empty for completely different context', async () => {
      const rows = await svc.recall(TENANT_INTEG_A, AGENT, DIFFERENT_CONTEXT, {
        minSimilarity: 0.5,
      })
      expect(rows).toHaveLength(0)
    })

    it('context_vector dimension is 1536', async () => {
      const { rows } = await pool.query<{ dims: number }>(
        `SELECT vector_dims(context_vector) AS dims
         FROM decision_memory WHERE id = $1`,
        [ids[0]],
      )
      expect(rows[0]!.dims).toBe(1536)
    })

    it('listPendingOutcomesOlderThan() returns the 1 decision without outcome', async () => {
      await pool.query(
        `UPDATE decision_memory SET decided_at = NOW() - INTERVAL '10 days' WHERE id = $1`,
        [ids[2]],
      )

      const pending = await svc.listPendingOutcomesOlderThan(7)
      const match = pending.filter((r) => r.id === ids[2])
      expect(match).toHaveLength(1)
      expect(match[0]!.tenant_id).toBe(TENANT_INTEG_A)
      expect(match[0]!.agent_id).toBe(AGENT)
    })

    it('listPendingOutcomesOlderThan() excludes decisions that already have outcome', async () => {
      await pool.query(
        `UPDATE decision_memory SET decided_at = NOW() - INTERVAL '10 days' WHERE id = ANY($1::uuid[])`,
        [[ids[0], ids[1]]],
      )

      const pending = await svc.listPendingOutcomesOlderThan(7)
      const outcomeIds = pending.filter((r) => ids.slice(0, 2).includes(r.id))
      expect(outcomeIds).toHaveLength(0)
    })

    it('delete() removes a decision and returns true', async () => {
      const deleted = await svc.delete(ids[0]!, TENANT_INTEG_A)
      expect(deleted).toBe(true)
    })

    it('recall() excludes deleted decisions', async () => {
      const rows = await svc.recall(TENANT_INTEG_A, AGENT, CONTEXT, {
        minSimilarity: 0.5,
      })
      expect(rows.every((r) => r.id !== ids[0])).toBe(true)
      expect(rows).toHaveLength(1)
    })

    it('listRecent() shows 2 remaining after deletion', async () => {
      const rows = await svc.listRecent(TENANT_INTEG_A, AGENT)
      expect(rows).toHaveLength(2)
      expect(rows.some((r) => r.id === ids[0])).toBe(false)
    })
  })

  describe('cross-tenant isolation (AC-P3-18, AC-P3-20)', () => {
    const SHARED_CONTEXT = { price: 19.99, conv_rate: 0.05 }
    const DIFFERENT_CONTEXT_B = { region: 'eu', category: 'garden' }
    const tenantAIds: string[] = []
    const tenantBIds: string[] = []

    beforeAll(async () => {
      await cleanup(pool)

      for (let i = 0; i < 5; i++) {
        const id = await svc.record({
          tenantId: TENANT_INTEG_A,
          agentId: AGENT,
          platform: 'shopify',
          entityId: `PA-${i}`,
          context: SHARED_CONTEXT,
          action: { newPrice: 17.99 + i },
        })
        tenantAIds.push(id)
      }

      for (let i = 0; i < 3; i++) {
        const id = await svc.record({
          tenantId: TENANT_INTEG_B,
          agentId: AGENT,
          platform: 'amazon',
          entityId: `PB-${i}`,
          context: DIFFERENT_CONTEXT_B,
          action: { newPrice: 12.99 + i },
        })
        tenantBIds.push(id)
      }

      for (const id of tenantAIds) {
        await svc.writeOutcome(id, TENANT_INTEG_A, { conv_rate_7d: 0.06, revenue_7d: 500 })
      }
    })

    it('tenant A records 5 decisions → tenant B recall returns 0', async () => {
      const rows = await svc.recall(TENANT_INTEG_B, AGENT, SHARED_CONTEXT, {
        minSimilarity: 0.1,
      })
      expect(rows).toHaveLength(0)
    })

    it('tenant A records decisions → tenant B listRecent returns only own', async () => {
      const rowsB = await svc.listRecent(TENANT_INTEG_B, AGENT)
      expect(rowsB).toHaveLength(3)
      for (const row of rowsB) {
        expect(row.tenant_id).toBe(TENANT_INTEG_B)
      }
      const aIdsInB = rowsB.filter((r) => tenantAIds.includes(r.id))
      expect(aIdsInB).toHaveLength(0)
    })

    it('tenant A recall with same context → returns ≥ 3 (has outcomes)', async () => {
      const rowsA = await svc.recall(TENANT_INTEG_A, AGENT, SHARED_CONTEXT, {
        minSimilarity: 0.5,
      })
      expect(rowsA.length).toBeGreaterThanOrEqual(3)
      for (const row of rowsA) {
        expect(row.tenant_id).toBe(TENANT_INTEG_A)
      }
    })

    it('tenant B listPendingOutcomesOlderThan returns only own pending decisions', async () => {
      await pool.query(
        `UPDATE decision_memory SET decided_at = NOW() - INTERVAL '10 days'
         WHERE tenant_id = ANY($1::uuid[])`,
        [TEST_TENANTS],
      )

      const pending = await svc.listPendingOutcomesOlderThan(7)
      const bPending = pending.filter((r) => r.tenant_id === TENANT_INTEG_B)
      expect(bPending).toHaveLength(3)

      const aPending = pending.filter((r) => r.tenant_id === TENANT_INTEG_A)
      expect(aPending).toHaveLength(0)
    })

    it('tenant B cannot writeOutcome for tenant A decision (UPDATE affects 0 rows)', async () => {
      await svc.writeOutcome(tenantAIds[0]!, TENANT_INTEG_B, { hijacked: true })

      const { rows } = await pool.query<{ outcome: unknown }>(
        `SELECT outcome FROM decision_memory WHERE id = $1`,
        [tenantAIds[0]],
      )
      const outcome = rows[0]!.outcome as Record<string, unknown>
      expect(outcome).not.toHaveProperty('hijacked')
      expect(outcome).toHaveProperty('conv_rate_7d')
    })

    it('tenant B cannot delete tenant A decision (returns false)', async () => {
      const deleted = await svc.delete(tenantAIds[1]!, TENANT_INTEG_B)
      expect(deleted).toBe(false)

      const { rowCount } = await pool.query(
        `SELECT 1 FROM decision_memory WHERE id = $1`,
        [tenantAIds[1]],
      )
      expect(rowCount).toBe(1)
    })

    it('recall with identical context across tenants returns disjoint result sets', async () => {
      for (const id of tenantBIds) {
        await svc.writeOutcome(id, TENANT_INTEG_B, { conv_rate_7d: 0.03 })
      }

      const rowsA = await svc.recall(TENANT_INTEG_A, AGENT, SHARED_CONTEXT, {
        minSimilarity: 0.5,
      })
      const rowsB = await svc.recall(TENANT_INTEG_B, AGENT, SHARED_CONTEXT, {
        minSimilarity: 0.1,
      })

      const idsA = new Set(rowsA.map((r) => r.id))
      const idsB = new Set(rowsB.map((r) => r.id))
      for (const id of idsA) {
        expect(idsB.has(id)).toBe(false)
      }
      for (const id of idsB) {
        expect(idsA.has(id)).toBe(false)
      }
    })
  })
})

export { TENANT_INTEG_A, TENANT_INTEG_B, TEST_TENANTS, AGENT }

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM decision_memory WHERE tenant_id = ANY($1::uuid[])`,
    [TEST_TENANTS],
  )
}
