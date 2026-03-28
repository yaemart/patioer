import type { Pool } from 'pg'
import { embedText, type EmbeddingPort } from './embeddings.js'
import type { DecisionMemoryRow } from './types.js'

export interface DecisionMemoryRecordInput {
  tenantId: string
  agentId: string
  platform?: string
  entityId?: string
  context: unknown
  action: unknown
}

export class DecisionMemoryService {
  constructor(
    private readonly pool: Pool,
    private readonly embedding?: EmbeddingPort,
  ) {}

  async recall(
    tenantId: string,
    agentId: string,
    currentContext: unknown,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<DecisionMemoryRow[]> {
    const limit = options?.limit ?? 5
    const minSim = options?.minSimilarity ?? (this.embedding ? 0.75 : 0.01)
    const text = JSON.stringify(currentContext ?? null)
    const vector = await embedText(text, this.embedding)
    if (vector.some((v) => !Number.isFinite(v))) {
      return []
    }
    const vecLiteral = `[${vector.join(',')}]`
    const { rows } = await this.pool.query<DecisionMemoryRow & { similarity: string }>(
      `SELECT id, tenant_id, agent_id, platform, entity_id, context, action, outcome,
              decided_at, outcome_at, deleted_at,
              1 - (context_vector <=> $3::vector) AS similarity
       FROM decision_memory
       WHERE tenant_id = $1 AND agent_id = $2
         AND outcome IS NOT NULL
         AND context_vector IS NOT NULL
         AND deleted_at IS NULL
         AND (1 - (context_vector <=> $3::vector)) >= $4
       ORDER BY context_vector <=> $3::vector
       LIMIT $5`,
      [tenantId, agentId, vecLiteral, minSim, limit],
    )
    return rows.map(({ similarity: _s, ...rest }) => ({
      ...rest,
      similarity: Number.parseFloat(_s),
    }))
  }

  async record(input: DecisionMemoryRecordInput): Promise<string> {
    const contextJson = JSON.stringify(input.context ?? null)
    const actionJson = JSON.stringify(input.action ?? null)
    const vector = await embedText(contextJson, this.embedding)
    const vecLiteral = `[${vector.join(',')}]`
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO decision_memory (tenant_id, agent_id, platform, entity_id, context, action, context_vector)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::vector)
       RETURNING id`,
      [
        input.tenantId,
        input.agentId,
        input.platform ?? null,
        input.entityId ?? null,
        contextJson,
        actionJson,
        vecLiteral,
      ],
    )
    return rows[0]!.id
  }

  async writeOutcome(decisionId: string, tenantId: string, outcome: unknown): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE decision_memory SET outcome = $3::jsonb, outcome_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND outcome IS NULL`,
      [decisionId, tenantId, JSON.stringify(outcome)],
    )
    return (rowCount ?? 0) > 0
  }

  async delete(decisionId: string, tenantId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE decision_memory SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [decisionId, tenantId],
    )
    return (rowCount ?? 0) > 0
  }

  async listRecent(
    tenantId: string,
    agentId?: string,
    opts?: { limit?: number },
  ): Promise<DecisionMemoryRow[]> {
    const limit = Math.min(opts?.limit ?? 20, 200)
    const params: unknown[] = [tenantId]
    const agentFilter = agentId ? ` AND agent_id = $${params.push(agentId)}` : ''
    const { rows } = await this.pool.query<DecisionMemoryRow>(
      `SELECT id, tenant_id, agent_id, platform, entity_id, context, action, outcome, decided_at, outcome_at, deleted_at
       FROM decision_memory
       WHERE tenant_id = $1 AND deleted_at IS NULL${agentFilter}
       ORDER BY decided_at DESC LIMIT $${params.push(limit)}`,
      params,
    )
    return rows
  }

  async listPendingOutcomesOlderThan(
    days: number,
    opts?: { limit?: number; tenantId?: string },
  ): Promise<
    Array<
      Pick<
        DecisionMemoryRow,
        'id' | 'tenant_id' | 'agent_id' | 'platform' | 'entity_id' | 'context' | 'action' | 'decided_at'
      >
    >
  > {
    const limit = Math.min(opts?.limit ?? 200, 1000)
    const params: unknown[] = [days]
    const tenantFilter = opts?.tenantId
      ? ` AND tenant_id = $${params.push(opts.tenantId)}`
      : ''
    const { rows } = await this.pool.query<
      Pick<
        DecisionMemoryRow,
        'id' | 'tenant_id' | 'agent_id' | 'platform' | 'entity_id' | 'context' | 'action' | 'decided_at'
      >
    >(
      `SELECT id, tenant_id, agent_id, platform, entity_id, context, action, decided_at
       FROM decision_memory
       WHERE outcome IS NULL
         AND deleted_at IS NULL
         AND decided_at < NOW() - make_interval(days => $1)${tenantFilter}
       ORDER BY decided_at ASC
       LIMIT $${params.push(limit)}`,
      params,
    )
    return rows
  }

}
