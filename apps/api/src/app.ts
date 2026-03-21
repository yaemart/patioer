import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import tenantPlugin from './plugins/tenant.js'
import healthRoute from './routes/health.js'

export const buildServer = () => {
  const app = Fastify({ logger: true })

  app.register(sensible)
  app.register(tenantPlugin)
  app.register(healthRoute)

  return app
}
