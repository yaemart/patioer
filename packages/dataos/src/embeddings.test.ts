import { describe, expect, it, vi } from 'vitest'
import { deterministicEmbedding, deterministicEmbeddingPort, embedText, EMBEDDING_DIM } from './embeddings.js'

describe('deterministicEmbedding', () => {
  it('returns 1536-d unit vector', () => {
    const v = deterministicEmbedding('hello world')
    expect(v).toHaveLength(EMBEDDING_DIM)
    let norm = 0
    for (const x of v) norm += x * x
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5)
  })

  it('is deterministic for same input', () => {
    const a = deterministicEmbedding('price-sentinel-context')
    const b = deterministicEmbedding('price-sentinel-context')
    expect(a).toEqual(b)
  })
})

describe('deterministicEmbeddingPort', () => {
  it('implements EmbeddingPort with deterministic fallback', async () => {
    const v = await deterministicEmbeddingPort.embed('test')
    expect(v).toHaveLength(EMBEDDING_DIM)
  })
})

describe('embedText', () => {
  it('falls back to deterministic when no port provided', async () => {
    const v = await embedText('test input')
    expect(v).toHaveLength(EMBEDDING_DIM)
  })

  it('delegates to injected EmbeddingPort', async () => {
    const fakeVec = new Array(EMBEDDING_DIM).fill(0.01)
    const port = { embed: vi.fn().mockResolvedValue(fakeVec) }
    const v = await embedText('some text', port)
    expect(port.embed).toHaveBeenCalledWith('some text')
    expect(v).toBe(fakeVec)
  })
})
