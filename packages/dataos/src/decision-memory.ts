import type { Pool } from 'pg'
import { embedText } from './embeddings.js'
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
    private readonly openaiApiKey?: string,
  ) {}

  async recall(
    tenantId: string,
    agentId: string,
    currentContext: unknown,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<DecisionMemoryRow[]> {
    const limit = options?.limit ?? 5
    const minSim = options?.minSimilarity ?? 0.85
    const text = JSON.stringify(currentContext)
    const vector = await embedText(text, { openaiApiKey: this.openaiApiKey })
    const vecLiteral = `[${vector.join(',')}]`
    const { rows } = await this.pool.query<DecisionMemoryRow & { similarity: string }>(
      `SELECT id, tenant_id, agent_id, platform, entity_id, context, action, outcome,
              decided_at, outcome_at,
              1 - (context_vector <=> $3::vector) AS similarity
       FROM decision_memory
       WHERE tenant_id = $1 AND agent_id = $2
         AND outcome IS NOT NULL
         AND context_vector IS NOT NULL
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
    const text = JSON.stringify(input.context)
    const vector = await embedText(text, { openaiApiKey: this.openaiApiKey })
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
        JSON.stringify(input.context),
        JSON.stringify(input.action),
        vecLiteral,
      ],
    )
    return rows[0]!.id
  }

  async writeOutcome(decisionId: string, tenantId: string, outcome: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE decision_memory SET outcome = $3::jsonb, outcome_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [decisionId, tenantId, JSON.stringify(outcome)],
    )
  }

  async listPendingOutcomesOlderThan(days: number): Promise<
    Array<{ id: string; tenant_id: string; entity_id: string | null; decided_at: Date }>
  > {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, entity_id, decided_at
       FROM decision_memory
       WHERE outcome IS NULL
         AND decided_at <= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY decided_at ASC
       LIMIT 500`,
      [days],
    )
    return rows as Array<{ id: string; tenant_id: string; entity_id: string | null; decided_at: Date }>
  }
}
