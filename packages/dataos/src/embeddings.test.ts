import { describe, expect, it, vi } from 'vitest'
import { deterministicEmbedding, deterministicEmbeddingPort, embedText, EMBEDDING_DIM } from './embeddings.js'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! ** 2
    normB += b[i]! ** 2
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

describe('deterministicEmbedding', () => {
  it('returns exactly 1536 dimensions', () => {
    const v = deterministicEmbedding('hello world')
    expect(v).toHaveLength(EMBEDDING_DIM)
    expect(v).toHaveLength(1536)
  })

  it('is deterministic (same input → same output)', () => {
    const a = deterministicEmbedding('price-sentinel-context')
    const b = deterministicEmbedding('price-sentinel-context')
    expect(a).toEqual(b)
  })

  it('produces different vectors for different inputs', () => {
    const a = deterministicEmbedding('price is 29.99')
    const b = deterministicEmbedding('category electronics weight 500')
    expect(a).not.toEqual(b)
  })

  it('output is a unit vector (norm ≈ 1.0)', () => {
    const v = deterministicEmbedding('hello world')
    let norm = 0
    for (const x of v) norm += x * x
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5)
  })

  it('cosine similarity of identical texts = 1.0', () => {
    const a = deterministicEmbedding('same text')
    const b = deterministicEmbedding('same text')
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10)
  })

  it('cosine similarity of different texts is significantly lower than 1.0', () => {
    const a = deterministicEmbedding('price 29.99 conv_rate 0.02')
    const b = deterministicEmbedding('totally unrelated electronics brand')
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeLessThan(0.5)
  })
})

describe('deterministicEmbeddingPort', () => {
  it('implements EmbeddingPort with deterministic fallback', async () => {
    const v = await deterministicEmbeddingPort.embed('test')
    expect(v).toHaveLength(EMBEDDING_DIM)
  })

  it('returns same result as deterministicEmbedding', async () => {
    const direct = deterministicEmbedding('port-test')
    const viaPort = await deterministicEmbeddingPort.embed('port-test')
    expect(viaPort).toEqual(direct)
  })
})

describe('embedText', () => {
  it('uses deterministicEmbedding when no port is provided', async () => {
    const v = await embedText('test input')
    const expected = deterministicEmbedding('test input')
    expect(v).toEqual(expected)
  })

  it('delegates to injected EmbeddingPort when provided', async () => {
    const fakeVec = new Array(EMBEDDING_DIM).fill(0.01)
    const port = { embed: vi.fn().mockResolvedValue(fakeVec) }
    const v = await embedText('some text', port)
    expect(port.embed).toHaveBeenCalledWith('some text')
    expect(v).toBe(fakeVec)
  })
})
