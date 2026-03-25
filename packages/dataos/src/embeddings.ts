import { createHash } from 'node:crypto'

const DIM = 1536

/** Deterministic 1536-d unit vector for tests / dev when OPENAI_API_KEY is unset. */
export function deterministicEmbedding(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0)
  let seed = 0n
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 131n + BigInt(text.charCodeAt(i))) % 9007199254740991n
  }
  const h = createHash('sha256').update(text).digest()
  for (let i = 0; i < DIM; i++) {
    const b = h[i % h.length]! ^ h[(i + 13) % h.length]!
    vec[i] = (b / 255) * 2 - 1
  }
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map((v) => v / norm)
}

export async function embedText(
  text: string,
  options: { openaiApiKey?: string; model?: string },
): Promise<number[]> {
  const key = options.openaiApiKey ?? process.env.OPENAI_API_KEY
  if (!key) {
    return deterministicEmbedding(text)
  }
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key })
  const model = options.model ?? 'text-embedding-3-small'
  const res = await client.embeddings.create({ model, input: text })
  const v = res.data[0]?.embedding
  if (!v || v.length !== DIM) {
    throw new Error(`embedding: expected ${DIM} dims, got ${v?.length ?? 0}`)
  }
  return v
}
