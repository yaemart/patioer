import { createHash } from 'node:crypto'

export const EMBEDDING_DIM = 1536

/**
 * Port interface for embedding providers.
 * Implementations live outside `packages/dataos` (composition root).
 */
export interface EmbeddingPort {
  embed(text: string): Promise<number[]>
}

/** Deterministic 1536-d unit vector for tests / dev when no real provider is configured. */
export function deterministicEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0)
  const h = createHash('sha256').update(text).digest()
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const b = h[i % h.length]! ^ h[(i + 13) % h.length]!
    vec[i] = (b / 255) * 2 - 1
  }
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map((v) => v / norm)
}

/** Fallback EmbeddingPort that uses deterministic hashing (no external SDK). */
export const deterministicEmbeddingPort: EmbeddingPort = {
  embed: (text: string) => Promise.resolve(deterministicEmbedding(text)),
}

/**
 * Resolve embedding: delegates to the injected port, or falls back to deterministic.
 * No direct SDK imports — the OpenAI implementation is provided by the composition root.
 */
export async function embedText(
  text: string,
  port?: EmbeddingPort,
): Promise<number[]> {
  return (port ?? deterministicEmbeddingPort).embed(text)
}
