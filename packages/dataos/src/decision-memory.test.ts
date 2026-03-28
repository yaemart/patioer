import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { DecisionMemoryService } from './decision-memory.js'

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const TENANT_B = '00000000-0000-0000-0000-000000000002'
const AGENT = 'price-sentinel'
const DECISION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

describe('DecisionMemoryService', () => {
  let query: ReturnType<typeof vi.fn>
  let pool: Pool

  beforeEach(() => {
    query = vi.fn()
    pool = { query } as unknown as Pool
    delete process.env.OPENAI_API_KEY
  })

  it('recall returns empty when no memories exist', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    const rows = await svc.recall(TENANT_A, AGENT, { price: 10 })
    expect(rows).toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('recall filters by tenant_id (cross-tenant isolation)', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.recall(TENANT_A, AGENT, { price: 10 })
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe(TENANT_A)
    expect(params[0]).not.toBe(TENANT_B)
  })

  it('recall filters by similarity threshold', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.recall(TENANT_A, AGENT, { price: 10 }, { minSimilarity: 0.9 })
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('(1 - (context_vector <=> $3::vector)) >= $4')
    expect(params[3]).toBe(0.9)
  })

  it('recall defaults minSimilarity to 0.01 for deterministic embeddings', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.recall(TENANT_A, AGENT, { price: 10 })
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[3]).toBe(0.01)
  })

  it('recall defaults minSimilarity to 0.75 when real embedding port is provided', async () => {
    query.mockResolvedValue({ rows: [] })
    const fakeEmbedding = { embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)) }
    const svc = new DecisionMemoryService(pool, fakeEmbedding)
    await svc.recall(TENANT_A, AGENT, { price: 10 })
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[3]).toBe(0.75)
  })

  it('record inserts decision with context_vector', async () => {
    query.mockResolvedValue({ rows: [{ id: DECISION_ID }] })
    const svc = new DecisionMemoryService(pool)
    const id = await svc.record({
      tenantId: TENANT_A,
      agentId: AGENT,
      context: { price: 10 },
      action: { newPrice: 11 },
    })
    expect(id).toBe(DECISION_ID)
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('INSERT INTO decision_memory')
    expect(sql).toContain('$7::vector')
    expect(typeof params[6]).toBe('string')
    expect(String(params[6])).toMatch(/^\[/)
  })

  it('writeOutcome updates outcome and outcome_at', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const svc = new DecisionMemoryService(pool)
    await svc.writeOutcome(DECISION_ID, TENANT_A, { success: true })
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('UPDATE decision_memory')
    expect(sql).toContain('outcome_at = NOW()')
    expect(sql).toContain('WHERE id = $1 AND tenant_id = $2')
    expect(params[0]).toBe(DECISION_ID)
    expect(params[1]).toBe(TENANT_A)
    expect(params[2]).toBe(JSON.stringify({ success: true }))
  })

  it('listRecent returns rows for tenant without agentId filter', async () => {
    const rows = [{ id: DECISION_ID, tenant_id: TENANT_A, agent_id: AGENT }]
    query.mockResolvedValue({ rows })
    const svc = new DecisionMemoryService(pool)
    const result = await svc.listRecent(TENANT_A)
    expect(result).toEqual(rows)
    const sql: string = query.mock.calls[0][0]
    expect(sql).toContain('WHERE tenant_id = $1')
    expect(sql).not.toContain('AND agent_id')
  })

  it('listRecent filters by agentId when provided', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listRecent(TENANT_A, AGENT)
    const sql: string = query.mock.calls[0][0]
    expect(sql).toContain('agent_id = $2')
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[1]).toBe(AGENT)
  })

  it('listRecent respects custom limit capped at 200', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listRecent(TENANT_A, undefined, { limit: 9999 })
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[1]).toBe(200)
  })

  it('delete soft-deletes a decision record and returns true when found', async () => {
    query.mockResolvedValue({ rowCount: 1 })
    const svc = new DecisionMemoryService(pool)
    const deleted = await svc.delete(DECISION_ID, TENANT_A)
    expect(deleted).toBe(true)
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('UPDATE decision_memory SET deleted_at = NOW()')
    expect(sql).toContain('tenant_id = $2')
    expect(sql).not.toContain('DELETE FROM')
    expect(params[0]).toBe(DECISION_ID)
    expect(params[1]).toBe(TENANT_A)
  })

  it('delete returns false when no row matched (cross-tenant guard)', async () => {
    query.mockResolvedValue({ rowCount: 0 })
    const svc = new DecisionMemoryService(pool)
    const deleted = await svc.delete(DECISION_ID, TENANT_B)
    expect(deleted).toBe(false)
  })

  it('listPendingOutcomesOlderThan queries decisions without outcome older than N days', async () => {
    const pendingRow = {
      id: DECISION_ID,
      tenant_id: TENANT_A,
      agent_id: AGENT,
      platform: 'shopify',
      entity_id: 'P001',
      context: { price: 29.99 },
      action: { newPrice: 27.99 },
      decided_at: '2026-03-01T00:00:00Z',
    }
    query.mockResolvedValue({ rows: [pendingRow] })
    const svc = new DecisionMemoryService(pool)
    const result = await svc.listPendingOutcomesOlderThan(7)
    expect(result).toEqual([pendingRow])
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('outcome IS NULL')
    expect(sql).toContain('make_interval(days => $1)')
    expect(sql).toContain('ORDER BY decided_at ASC')
    expect(params[0]).toBe(7)
    expect(params[1]).toBe(200)
  })

  it('listPendingOutcomesOlderThan respects custom limit capped at 1000', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listPendingOutcomesOlderThan(7, { limit: 9999 })
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[0]).toBe(7)
    expect(params[1]).toBe(1000)
  })

  it('listPendingOutcomesOlderThan returns empty array when no pending decisions', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    const result = await svc.listPendingOutcomesOlderThan(7)
    expect(result).toEqual([])
  })

  it('listPendingOutcomesOlderThan filters by tenantId when provided (Constitution Ch2.5)', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listPendingOutcomesOlderThan(7, { tenantId: TENANT_A })
    const sql: string = query.mock.calls[0][0]
    const params: unknown[] = query.mock.calls[0][1]
    expect(sql).toContain('AND tenant_id = $2')
    expect(params[0]).toBe(7)
    expect(params[1]).toBe(TENANT_A)
    expect(params[2]).toBe(200)
  })

  it('listPendingOutcomesOlderThan omits tenant_id filter when tenantId is not provided', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listPendingOutcomesOlderThan(7)
    const sql: string = query.mock.calls[0][0]
    expect(sql).not.toContain('AND tenant_id')
  })

  it('listPendingOutcomesOlderThan with tenantId and custom limit', async () => {
    query.mockResolvedValue({ rows: [] })
    const svc = new DecisionMemoryService(pool)
    await svc.listPendingOutcomesOlderThan(14, { tenantId: TENANT_B, limit: 50 })
    const params: unknown[] = query.mock.calls[0][1]
    expect(params[0]).toBe(14)
    expect(params[1]).toBe(TENANT_B)
    expect(params[2]).toBe(50)
  })
})
