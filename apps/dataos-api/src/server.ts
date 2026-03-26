import 'dotenv/config'
import Fastify from 'fastify'
import type OpenAI from 'openai'
import { createDataOsServices, type EmbeddingPort, EMBEDDING_DIM, deterministicEmbeddingPort } from '@patioer/dataos'
import { registerInternalRoutes } from './internal-routes.js'
import { parseRedisConnection } from './redis-url.js'
import { startIngestionWorker } from './workers/ingestion.js'
import { startFeatureAgentInterval } from './workers/feature-agent.js'
import { renderMetrics } from './metrics.js'

const port = Number.parseInt(process.env.PORT ?? '3300', 10)
const databaseUrl = process.env.DATABASE_URL

const internalKey = process.env.DATAOS_INTERNAL_KEY
if (!internalKey && process.env.NODE_ENV === 'production') {
  console.error('DATAOS_INTERNAL_KEY is required in production (Constitution Ch9)')
  process.exit(1)
}
const resolvedInternalKey = internalKey ?? 'dev-dataos-internal-key'
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const bullUrl = process.env.BULLMQ_CONNECTION_URL ?? redisUrl
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'
const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default'
const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? ''

if (!databaseUrl) {
  console.error('DATABASE_URL is required for DataOS API')
  process.exit(1)
}

function createOpenAIEmbeddingPort(apiKey: string): EmbeddingPort {
  let _client: OpenAI | null = null
  return {
    async embed(text: string): Promise<number[]> {
      if (!_client) {
        // Documented exception to no-inline-imports:
        // OpenAI SDK is only needed when OPENAI_API_KEY is configured.
        // Keep deterministic mode startup light by lazy-loading at first embed call.
        const { default: OpenAI } = await import('openai')
        _client = new OpenAI({ apiKey })
      }
      const res = await _client.embeddings.create({ model: 'text-embedding-3-small', input: text })
      const v = res.data[0]?.embedding
      if (!v || v.length !== EMBEDDING_DIM) {
        throw new Error(`embedding: expected ${EMBEDDING_DIM} dims, got ${v?.length ?? 0}`)
      }
      return v
    },
  }
}

const openaiKey = process.env.OPENAI_API_KEY
const embeddingPort = openaiKey ? createOpenAIEmbeddingPort(openaiKey) : deterministicEmbeddingPort

const services = createDataOsServices({
  databaseUrl,
  redisUrl,
  embedding: embeddingPort,
  clickhouse: {
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
    database: 'electroos_events',
  },
})

const redisConn = parseRedisConnection(bullUrl)
const worker = startIngestionWorker(services, redisConn)
const featureEveryMs = Number.parseInt(process.env.DATAOS_FEATURE_AGENT_MS ?? `${15 * 60 * 1000}`, 10)
const featureMaxItems = Number.parseInt(process.env.DATAOS_FEATURE_AGENT_MAX_ITEMS ?? '', 10) || undefined
const featureTimer = startFeatureAgentInterval(services, featureEveryMs, { maxItemsPerTick: featureMaxItems })

const app = Fastify({ logger: true })

app.get('/health', async () => ({ ok: true, service: 'dataos-api' }))

app.get('/metrics', async (_, reply) => {
  reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  return reply.send(await renderMetrics())
})

registerInternalRoutes(app, services, resolvedInternalKey)

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(featureTimer)
  try { await worker.close() } catch (e) { console.error('[dataos-api] worker close error', e) }
  try { await services.shutdown() } catch (e) { console.error('[dataos-api] services shutdown error', e) }
  try { await app.close() } catch (e) { console.error('[dataos-api] app close error', e) }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}

// Best-effort cache warmup — errors are logged but do not abort startup
const warmupTenantIds = (process.env.DATAOS_WARMUP_TENANT_IDS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => {
    console.log(`[dataos-api] listening ${addr}`)
    if (warmupTenantIds.length > 0) {
      Promise.all(
        warmupTenantIds.map((tenantId) =>
          services.featureStore
            .warmupCache(tenantId)
            .then((n) => console.log(`[dataos-api] cache warmup tenant=${tenantId} rows=${n}`))
            .catch((err) => console.warn('[dataos-api] cache warmup failed', err)),
        ),
      ).catch(() => {})
    }
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
