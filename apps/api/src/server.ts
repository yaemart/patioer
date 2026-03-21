import dotenv from 'dotenv'
import { buildServer } from './app.js'

dotenv.config()

const rawPort = process.env.PORT
const port = rawPort !== undefined ? parseInt(rawPort, 10) : 3100

if (Number.isNaN(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid PORT value: "${rawPort}"\n`)
  process.exit(1)
}

const app = buildServer()

const shutdown = (): void => {
  app
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

app
  .listen({ host: '0.0.0.0', port })
  .then(() => {
    app.log.info({ port }, 'ElectroOS API started')
  })
  .catch((error) => {
    app.log.error(error, 'Failed to start server')
    process.exit(1)
  })
