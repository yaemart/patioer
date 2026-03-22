import dotenv from 'dotenv'
import { buildServer } from './app.js'
import { bootstrapActiveAgents } from './lib/agent-bootstrap.js'
import { createPaperclipBridgeFromEnv } from './lib/paperclip-bridge.js'
import { closeRedisClient } from './lib/redis.js'
import { gracefulShutdown } from './lib/graceful-shutdown.js'
import { replayPendingWebhooks } from './lib/webhook-replay.js'
import { handleWebhookTopic } from './lib/webhook-topic-handler.js'

dotenv.config()

const rawPort = process.env.PORT
const port = rawPort !== undefined ? parseInt(rawPort, 10) : 3100

if (Number.isNaN(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid PORT value: "${rawPort}"\n`)
  process.exit(1)
}

const app = buildServer()

const shutdown = async (): Promise<void> => {
  const code = await gracefulShutdown(() => app.close(), closeRedisClient)
  process.exit(code)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

app
  .listen({ host: '0.0.0.0', port })
  .then(async () => {
    app.log.info({ port }, 'ElectroOS API started')

    const appBaseUrl = process.env.APP_BASE_URL ?? ''
    const bridge = createPaperclipBridgeFromEnv()

    if (bridge && appBaseUrl) {
      bootstrapActiveAgents(bridge, appBaseUrl)
        .then((r) => {
          app.log.info(r, 'agent bootstrap complete')
        })
        .catch((err: unknown) => {
          app.log.warn({ err }, 'agent bootstrap failed — heartbeats will resume on next trigger')
        })
    }

    replayPendingWebhooks(handleWebhookTopic)
      .then((r) => {
        if (r.total > 0) app.log.info(r, 'webhook replay complete')
      })
      .catch((err: unknown) => {
        app.log.warn({ err }, 'webhook replay failed')
      })
  })
  .catch((error) => {
    app.log.error(error, 'Failed to start server')
    process.exit(1)
  })
