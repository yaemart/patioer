import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import tenantPlugin from './plugins/tenant.js'
import healthRoute from './routes/health.js'
import tenantDiscoveryRoute from './routes/tenant-discovery.js'
import shopifyOauthRoute from './routes/shopify/oauth.js'
import shopifyWebhookRoute from './routes/shopify/webhook.js'
import productsRoute from './routes/products.js'
import ordersRoute from './routes/orders.js'

export const buildServer = () => {
  const app = Fastify({ logger: true })

  app.register(sensible)
  app.register(tenantPlugin)
  app.register(healthRoute)
  app.register(tenantDiscoveryRoute)
  app.register(shopifyOauthRoute)
  app.register(shopifyWebhookRoute)
  app.register(productsRoute)
  app.register(ordersRoute)

  return app
}
