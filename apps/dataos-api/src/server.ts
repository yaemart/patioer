import 'dotenv/config'
import Fastify from 'fastify'
import { createDataOsServices } from '@patioer/dataos'
import { registerInternalRoutes } from './internal-routes.js'
import { parseRedisConnection } from './redis-url.js'
import { startIngestionWorker } from './workers/ingestion.js'
import { startFeatureAgentInterval } from './workers/feature-agent.js'
import { scheduleInsightAgent } from './workers/insight-agent.js'
import { renderMetrics } from './metrics.js'

const port = Number.parseInt(process.env.PORT ?? '3300', 10)
const internalKey = process.env.DATAOS_INTERNAL_KEY ?? 'dev-dataos-internal-key'
const databaseUrl = process.env.DATABASE_URL
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const bullUrl = process.env.BULLMQ_CONNECTION_URL ?? redisUrl
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123'
const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default'
const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? ''

if (!databaseUrl) {
  console.error('DATABASE_URL is required for DataOS API')
  process.exit(1)
}

const services = createDataOsServices({
  databaseUrl,
  redisUrl,
  openaiApiKey: process.env.OPENAI_API_KEY,
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
startFeatureAgentInterval(services, featureEveryMs)
scheduleInsightAgent(services)

const app = Fastify({ logger: true })

app.get('/health', async () => ({ ok: true, service: 'dataos-api' }))

app.get('/metrics', async (_, reply) => {
  reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  return reply.send(await renderMetrics())
})

registerInternalRoutes(app, services, internalKey)

async function shutdown(): Promise<void> {
  await worker.close()
  await services.shutdown()
  await app.close()
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0))
})

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => {
    console.log(`[dataos-api] listening ${addr}`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
