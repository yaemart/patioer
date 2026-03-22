import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import tenantPlugin from './plugins/tenant.js'
import healthRoute from './routes/health.js'
import tenantDiscoveryRoute from './routes/tenant-discovery.js'
import shopifyOauthRoute from './routes/shopify/oauth.js'
import shopifyWebhookRoute from './routes/shopify/webhook.js'
import productsRoute from './routes/products.js'
import ordersRoute from './routes/orders.js'
import agentsRoute from './routes/agents.js'
import approvalsRoute from './routes/approvals.js'
import agentsExecuteRoute from './routes/agents-execute.js'
import amazonOAuthRoute from './routes/amazon/oauth.js'
import amazonWebhookRoute from './routes/amazon/webhook.js'
import tikTokOAuthRoute from './routes/tiktok/oauth.js'
import tikTokWebhookRoute from './routes/tiktok/webhook.js'
import shopeeOAuthRoute from './routes/shopee/oauth.js'
import shopeeWebhookRoute from './routes/shopee/webhook.js'
import platformCredentialsRoute from './routes/platform-credentials.js'

export const buildServer = () => {
  const app = Fastify({ logger: true })

  app.register(swagger, {
    openapi: {
      info: {
        title: 'ElectroOS API',
        description:
          'ElectroOS multi-tenant API: agents, approvals, Shopify / Amazon / TikTok / Shopee OAuth & webhooks, Paperclip execution.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${process.env.PORT ?? 3100}` }],
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
          tenantId: { type: 'apiKey', name: 'x-tenant-id', in: 'header' },
        },
      },
    },
  })
  app.register(swaggerUi, { routePrefix: '/api/v1/docs' })

  app.register(sensible)
  app.register(tenantPlugin)
  app.register(healthRoute)
  app.register(tenantDiscoveryRoute)
  app.register(shopifyOauthRoute)
  app.register(shopifyWebhookRoute)
  app.register(productsRoute)
  app.register(ordersRoute)
  app.register(agentsRoute)
  app.register(approvalsRoute)
  app.register(agentsExecuteRoute)
  app.register(amazonOAuthRoute)
  app.register(amazonWebhookRoute)
  app.register(tikTokOAuthRoute)
  app.register(tikTokWebhookRoute)
  app.register(shopeeOAuthRoute, { prefix: '/api/v1/shopee' })
  app.register(shopeeWebhookRoute)
  app.register(platformCredentialsRoute)

  return app
}
